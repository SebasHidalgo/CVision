import { randomUUID } from "node:crypto";
import type { PrismaClient, UsageKind } from "@prisma/client";
import { quotaPeriodFor, type PlanStanding } from "@/lib/billing/access";
import { decideEntitlement, type InterviewEntitlement } from "@/lib/interviewEntitlement";

/** Every ledger row this tool writes carries this prefix in its refId, so the next run can take it back. */
export const DEV_REF_PREFIX = "dev-usage:";

export type DevUsageTarget = {
  /** Non-refunded period interviews in the current quota period. */
  interviewsUsed?: number;
  /** A non-refunded trial on the account. */
  trialUsed?: boolean;
  /** Pack credits held. */
  credits?: number;
  /** The manual comp: PRO, or FREE to clear it (a paid subscription still wins). */
  plan?: "FREE" | "PRO";
};

export type DevUsageReport = { plan: PlanStanding["plan"]; periodEnd: Date; interviewsUsed: number; trialUsed: boolean; credits: number; notes: string[] };

type Db = Pick<PrismaClient, "usageEvent" | "user" | "interview" | "$transaction">;

/** The reset's audit rows: refunded on creation, so they count for nothing, and never removed by a later run. */
export const DEV_RESET_PREFIX = "dev-reset:";
export const DEV_RESET_REASON = "DEV_RESET_TRIAL";

export type DevResetReport = {
  /** Trial units given back. */
  trialsReset: number;
  /** Interviews not yet finished that held a trial unit: their next start reserves again. */
  interviewsReleased: number;
  /** Of those, interviews whose unit no longer existed (a ledger row deleted by hand). */
  dangling: number;
  /** What the next start gets after the reset. */
  entitlement: InterviewEntitlement;
  notes: string[];
};

/**
 * Makes the account's free trial available again, consistently: every live
 * trial unit is given back (marked, like any refund), every interview that
 * can still start and holds a trial unit, or a unit that no longer exists,
 * lets go of it, and an audit row records the reset. Interviews, their
 * transcripts and their feedback stay. What else keeps a trial away (a
 * subscription once, a full interview, a Pro plan) is reported, not undone.
 */
export async function resetDevTrial(db: Db, userId: string, standingOf: (userId: string, now: Date) => Promise<PlanStanding>, now = new Date()): Promise<DevResetReport> {
  const counts = await db.$transaction(async (tx) => {
    const reset = await tx.usageEvent.updateMany({ where: { userId, kind: "INTERVIEW_TRIAL", refundedAt: null }, data: { refundedAt: now, refundReason: DEV_RESET_REASON } });
    const held = await tx.interview.findMany({
      where: { userId, usageEventId: { not: null }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
      select: { id: true, usageEventId: true, paidBy: true },
    });
    const ids = held.flatMap((row) => (row.usageEventId ? [row.usageEventId] : []));
    const existing = new Set((await tx.usageEvent.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((row) => row.id));
    const missing = held.filter((row) => row.usageEventId !== null && !existing.has(row.usageEventId));
    const release = held.filter((row) => row.paidBy === "TRIAL" || missing.includes(row));
    if (release.length > 0) await tx.interview.updateMany({ where: { id: { in: release.map((row) => row.id) } }, data: { usageEventId: null } });
    await tx.usageEvent.create({
      data: { userId, kind: "INTERVIEW_TRIAL", refId: `${DEV_RESET_PREFIX}${now.toISOString()}:${randomUUID()}`, createdAt: now, refundedAt: now, refundReason: DEV_RESET_REASON },
    });
    return { trialsReset: reset.count, interviewsReleased: release.length, dangling: missing.length };
  });

  const standing = await standingOf(userId, now);
  const period = quotaPeriodFor(standing, now);
  const [periodUsed, fullEver, creditRows] = await Promise.all([
    db.usageEvent.count({ where: { userId, kind: "INTERVIEW", refundedAt: null, createdAt: { gte: period.start, lt: period.end } } }),
    db.usageEvent.count({ where: { userId, kind: { in: ["INTERVIEW", "INTERVIEW_CREDIT"] }, refundedAt: null } }),
    db.usageEvent.groupBy({
      by: ["kind"],
      where: { userId, OR: [{ kind: { in: ["INTERVIEW_CREDIT_GRANT", "INTERVIEW_CREDIT_REVOKE"] } }, { kind: "INTERVIEW_CREDIT", refundedAt: null }] },
      _sum: { units: true },
    }),
  ]);
  const units = (kind: UsageKind) => creditRows.find((row) => row.kind === kind)?._sum.units ?? 0;
  const entitlement = decideEntitlement({
    plan: standing.plan,
    periodUsed,
    credits: Math.max(0, units("INTERVIEW_CREDIT_GRANT") - units("INTERVIEW_CREDIT_REVOKE") - units("INTERVIEW_CREDIT")),
    trialsUsed: 0,
    hadVoice: standing.everSubscribed || fullEver > 0,
    periodEnd: period.end,
  });

  const notes: string[] = [];
  if (counts.dangling > 0) notes.push(`${counts.dangling} interview(s) held a unit that no longer exists on the ledger (a row deleted by hand): released`);
  if (entitlement.source !== "trial") {
    notes.push(
      standing.plan === "PRO"
        ? "the account is Pro: its next start takes a period interview or a credit, not the trial (use --plan free to clear a comp)"
        : entitlement.source === "credit"
          ? "the account holds pack credits: its next start uses one before the trial"
          : standing.everSubscribed
            ? "the account had a subscription once: accounts that had voice get no trial; use another account"
            : "the account ran a full interview: accounts that had voice get no trial; use another account",
    );
  }
  return { ...counts, entitlement, notes };
}

/**
 * Puts an account's ledger in a given state without a call: the tool's own
 * rows are removed first, then rows are added (or credits revoked) to reach
 * the target. Rows the app wrote are never touched, so a target below what
 * the account really used cannot be reached and is reported instead.
 */
export async function applyDevUsage(
  db: Db,
  userId: string,
  target: DevUsageTarget,
  standingOf: (userId: string, now: Date) => Promise<PlanStanding>,
  now = new Date(),
): Promise<DevUsageReport> {
  const notes: string[] = [];
  if (target.plan) await db.user.update({ where: { id: userId }, data: { compPlan: target.plan === "PRO" ? "PRO" : null } });
  await db.usageEvent.deleteMany({ where: { userId, refId: { startsWith: DEV_REF_PREFIX } } });

  const standing = await standingOf(userId, now);
  const period = quotaPeriodFor(standing, now);
  const row = (kind: UsageKind, units = 1) => ({ userId, kind, units, refId: `${DEV_REF_PREFIX}${kind}:${randomUUID()}`, createdAt: now });

  const periodUsed = () =>
    db.usageEvent.count({ where: { userId, kind: "INTERVIEW", refundedAt: null, createdAt: { gte: period.start, lt: period.end } } });
  const trialsUsed = () => db.usageEvent.count({ where: { userId, kind: "INTERVIEW_TRIAL", refundedAt: null } });
  const creditBalance = async () => {
    const rows = await db.usageEvent.groupBy({
      by: ["kind"],
      where: { userId, OR: [{ kind: { in: ["INTERVIEW_CREDIT_GRANT", "INTERVIEW_CREDIT_REVOKE"] } }, { kind: "INTERVIEW_CREDIT", refundedAt: null }] },
      _sum: { units: true },
    });
    const sum = (kind: UsageKind) => rows.find((r) => r.kind === kind)?._sum.units ?? 0;
    return sum("INTERVIEW_CREDIT_GRANT") - sum("INTERVIEW_CREDIT_REVOKE") - sum("INTERVIEW_CREDIT");
  };

  const adds: ReturnType<typeof row>[] = [];
  if (target.interviewsUsed !== undefined) {
    const real = await periodUsed();
    if (real > target.interviewsUsed) notes.push(`${real} real interviews already used this period; cannot go down to ${target.interviewsUsed}`);
    for (let i = real; i < target.interviewsUsed; i++) adds.push(row("INTERVIEW"));
  }
  if (target.trialUsed !== undefined) {
    const real = await trialsUsed();
    if (target.trialUsed && real === 0) adds.push(row("INTERVIEW_TRIAL"));
    if (!target.trialUsed && real > 0) notes.push("the account used its trial for real; it stays used");
  }
  if (target.credits !== undefined) {
    const real = await creditBalance();
    if (target.credits > real) adds.push(row("INTERVIEW_CREDIT_GRANT", target.credits - real));
    if (target.credits < real) adds.push(row("INTERVIEW_CREDIT_REVOKE", real - target.credits));
  }
  if (adds.length > 0) await db.usageEvent.createMany({ data: adds });

  return {
    plan: standing.plan,
    periodEnd: period.end,
    interviewsUsed: await periodUsed(),
    trialUsed: (await trialsUsed()) > 0,
    credits: Math.max(0, await creditBalance()),
    notes,
  };
}
