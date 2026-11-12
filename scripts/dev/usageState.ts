import { randomUUID } from "node:crypto";
import type { PrismaClient, UsageKind } from "@prisma/client";
import { quotaPeriodFor, type PlanStanding } from "@/lib/billing/access";

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

type Db = Pick<PrismaClient, "usageEvent" | "user" | "$transaction">;

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
