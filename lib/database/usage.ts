import "server-only";

import { Prisma, type Plan, type UsageKind } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import {
  AnalysisQuotaExceededError,
  InterviewQuotaExceededError,
  type ErrorMeta,
} from "@/lib/error/errors";
import { handleError } from "@/lib/error/handleError";
import {
  INTERVIEW_TIERS,
  PLANS,
  quotaPeriod,
  type AnalysisQuotaView,
  type InterviewQuotaView,
  type InterviewTierId,
  type PlanId,
} from "@/lib/plans";
import { resolvePlanStanding, resolvePlanStandingIn } from "./billing";
import { expireAbandonedInterviews } from "./interviewExpiry";

/**
 * The usage ledger. No session here: the callers are the actions (which
 * resolved the session and pass their own id), the session endpoint, the
 * post-call path (which has no session and refunds by event id) and the
 * billing webhook (credits). Every read and write is scoped by the user id
 * it was given.
 *
 * The primitives, and nothing else touches the table: `reserveUsage` (check
 * and insert in one serializable transaction), `refundUsage`, and for the
 * credits `grantInterviewCredits`, `revokeUnusedInterviewCredits` and
 * `interviewCreditBalance`. The plan is never read from a column: it is
 * derived (lib/billing/access.ts) inside the same transaction as the
 * count. The expiry module imports `refundUsage` and this file imports the
 * expiry: a deliberate cycle of call-time bindings (see interviewExpiry.ts).
 */

const RACE_CODES = new Set(["P2034"]);
const UNIQUE_VIOLATION = "P2002";
const RESERVE_ATTEMPTS = 3;

export type Reservation = { eventId: string };

type Allowance = {
  limit: number;
  /** Null for a lifetime quota (the trial). */
  period: { start: Date; end: Date } | null;
};

/** The kinds a reservation can be made of; grants and revokes are written by the webhook, never reserved. */
function allowanceFor(plan: PlanId, kind: UsageKind, now: Date): Allowance {
  const limits = PLANS[plan];
  switch (kind) {
    case "ANALYSIS":
      return { limit: limits.analysesPerMonth, period: quotaPeriod(now) };
    case "INTERVIEW":
      return { limit: limits.interviewsPerMonth, period: quotaPeriod(now) };
    case "INTERVIEW_TRIAL":
      return { limit: limits.trialInterviews, period: null };
    case "INTERVIEW_CREDIT":
    case "INTERVIEW_CREDIT_GRANT":
    case "INTERVIEW_CREDIT_REVOKE":
      throw new Error(`${kind} is not reserved through reserveUsage`);
  }
}

function refusal(plan: PlanId, kind: UsageKind, allowance: Allowance): never {
  const meta: ErrorMeta = {
    plan,
    ...(allowance.period ? { resetsAt: allowance.period.end.toISOString() } : {}),
  };
  if (kind === "ANALYSIS") throw new AnalysisQuotaExceededError(meta);
  throw new InterviewQuotaExceededError(meta);
}

/**
 * Takes one unit of `kind` for the user, or throws the typed refusal with
 * the reset date. The count and the insert run under serializable isolation
 * and the loser of a race retries, so the last unit is taken once.
 */
export async function reserveUsage(
  userId: string,
  kind: UsageKind,
  refId: string,
  now = new Date(),
): Promise<Reservation> {
  try {
    for (let round = 0; round < RESERVE_ATTEMPTS; round += 1) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const { plan } = await resolvePlanStandingIn(tx, userId, now);
            const allowance = allowanceFor(plan, kind, now);

            const used = await tx.usageEvent.count({
              where: {
                userId,
                kind,
                refundedAt: null,
                ...(allowance.period
                  ? { createdAt: { gte: allowance.period.start, lt: allowance.period.end } }
                  : {}),
              },
            });
            if (used >= allowance.limit) refusal(plan, kind, allowance);

            const event = await tx.usageEvent.create({
              data: { userId, kind, refId, createdAt: now },
              select: { id: true },
            });
            return { eventId: event.id };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const raced =
          error instanceof Prisma.PrismaClientKnownRequestError && RACE_CODES.has(error.code);
        if (!raced || round === RESERVE_ATTEMPTS - 1) throw error;
      }
    }
    throw new Error("unreachable");
  } catch (error) {
    handleError(error, "Failed to reserve usage");
  }
}

/** Gives a unit back, once: a second refund of the same event changes nothing. */
export async function refundUsage(eventId: string, reason: string): Promise<boolean> {
  try {
    const result = await prisma.usageEvent.updateMany({
      where: { id: eventId, refundedAt: null },
      data: { refundedAt: new Date(), refundReason: reason },
    });
    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to refund usage");
  }
}

export type InterviewReservation = Reservation & { kind: UsageKind; tier: InterviewTierId; seconds: number };

/**
 * The interview unit a plan gets: a FREE account's one trial on the short
 * agent, a PRO account's monthly interview on the full one. The plan decides
 * the kind, the kind decides the agent.
 */
export async function reserveInterview(userId: string, interviewId: string, now = new Date()): Promise<InterviewReservation> {
  const plan = await fetchPlan(userId);
  const tier = PLANS[plan].interviewTier;
  const kind: UsageKind = tier === "TRIAL" ? "INTERVIEW_TRIAL" : "INTERVIEW";
  const { eventId } = await reserveUsage(userId, kind, interviewId, now);
  return { eventId, kind, tier, seconds: INTERVIEW_TIERS[tier].seconds };
}

/** The plan in force: an access-granting subscription, else the manual comp, else Free. */
export async function fetchPlan(userId: string, now = new Date()): Promise<PlanId> {
  return (await resolvePlanStanding(userId, now)).plan;
}

/** How many pack credits the user holds: grants minus revokes minus the non-refunded consumption. */
export async function interviewCreditBalance(userId: string): Promise<number> {
  try {
    return await creditBalanceIn(prisma, userId);
  } catch (error) {
    handleError(error, `Failed to read the credit balance (user=${userId})`);
  }
}

async function creditBalanceIn(db: Prisma.TransactionClient, userId: string): Promise<number> {
  const [granted, revoked, used] = await Promise.all([
    db.usageEvent.aggregate({ where: { userId, kind: "INTERVIEW_CREDIT_GRANT" }, _sum: { units: true } }),
    db.usageEvent.aggregate({ where: { userId, kind: "INTERVIEW_CREDIT_REVOKE" }, _sum: { units: true } }),
    db.usageEvent.count({ where: { userId, kind: "INTERVIEW_CREDIT", refundedAt: null } }),
  ]);
  return Math.max(0, (granted._sum.units ?? 0) - (revoked._sum.units ?? 0) - used);
}

/**
 * Credits a pack purchase to the user, once: the transaction id is the
 * grant's `refId`, unique per kind, so a replayed event changes nothing.
 */
export async function grantInterviewCredits(
  userId: string,
  { units, transactionId, now = new Date() }: { units: number; transactionId: string; now?: Date },
): Promise<{ granted: boolean }> {
  try {
    await prisma.usageEvent.create({
      data: { userId, kind: "INTERVIEW_CREDIT_GRANT", refId: transactionId, units, createdAt: now },
    });
    return { granted: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
      return { granted: false };
    }
    handleError(error, `Failed to grant interview credits (user=${userId}, transaction=${transactionId})`);
  }
}

/**
 * A refund or chargeback of a pack takes back what was not used: the
 * smaller of the grant and the current balance, written as one revoke
 * keyed by the adjustment id (so a repeated event revokes nothing twice,
 * and a revoke of zero still leaves its mark). Consumption already made is
 * not clawed back: those interviews happened. Serializable, like every
 * read-then-write on this table.
 */
export async function revokeUnusedInterviewCredits(
  userId: string,
  { transactionId, adjustmentId, now = new Date() }: { transactionId: string; adjustmentId: string; now?: Date },
): Promise<{ revoked: number; outcome: "revoked" | "already" | "no-grant" }> {
  try {
    for (let round = 0; round < RESERVE_ATTEMPTS; round += 1) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const already = await tx.usageEvent.findUnique({
              where: { kind_refId: { kind: "INTERVIEW_CREDIT_REVOKE", refId: adjustmentId } },
              select: { units: true },
            });
            if (already) return { revoked: already.units, outcome: "already" as const };

            const grant = await tx.usageEvent.findUnique({
              where: { kind_refId: { kind: "INTERVIEW_CREDIT_GRANT", refId: transactionId } },
              select: { units: true, userId: true },
            });
            if (!grant || grant.userId !== userId) return { revoked: 0, outcome: "no-grant" as const };

            const balance = await creditBalanceIn(tx, userId);
            const units = Math.max(0, Math.min(grant.units, balance));
            await tx.usageEvent.create({
              data: { userId, kind: "INTERVIEW_CREDIT_REVOKE", refId: adjustmentId, units, createdAt: now },
            });
            return { revoked: units, outcome: "revoked" as const };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const raced =
          error instanceof Prisma.PrismaClientKnownRequestError && RACE_CODES.has(error.code);
        if (!raced || round === RESERVE_ATTEMPTS - 1) throw error;
      }
    }
    throw new Error("unreachable");
  } catch (error) {
    handleError(error, `Failed to revoke interview credits (user=${userId}, adjustment=${adjustmentId})`);
  }
}

export type UsageSummary = {
  plan: PlanId;
  analyses: { used: number; limit: number; left: number; announce: boolean };
  interviews: { used: number; limit: number; left: number };
  trial: { available: boolean; used: boolean };
  /** When the monthly counters reset. */
  resetsAt: Date;
};

/**
 * The user's standing against every quota, for the pages that show it and
 * the actions that pre-check it. Reading a quota is also the sweep for
 * abandoned interviews, so a reservation nobody came back to is given back
 * before it is counted.
 */
export async function usageSummary(userId: string, now = new Date()): Promise<UsageSummary> {
  try {
    await expireAbandonedInterviews(userId, now);
    const plan = await fetchPlan(userId);
    const limits = PLANS[plan];
    const period = quotaPeriod(now);

    const countOf = (kind: UsageKind, inPeriod: boolean) =>
      prisma.usageEvent.count({
        where: {
          userId,
          kind,
          refundedAt: null,
          ...(inPeriod ? { createdAt: { gte: period.start, lt: period.end } } : {}),
        },
      });
    const [analyses, interviews, trials] = await Promise.all([
      countOf("ANALYSIS", true),
      countOf("INTERVIEW", true),
      countOf("INTERVIEW_TRIAL", false),
    ]);

    return {
      plan,
      analyses: {
        used: analyses,
        limit: limits.analysesPerMonth,
        left: Math.max(0, limits.analysesPerMonth - analyses),
        announce: limits.announceAnalyses,
      },
      interviews: {
        used: interviews,
        limit: limits.interviewsPerMonth,
        left: Math.max(0, limits.interviewsPerMonth - interviews),
      },
      trial: {
        used: trials >= limits.trialInterviews && limits.trialInterviews > 0 ? true : trials > 0,
        available: trials < limits.trialInterviews,
      },
      resetsAt: period.end,
    };
  } catch (error) {
    handleError(error, "Failed to read the usage summary");
  }
}

/** The interview tier a plan runs on, for callers that only need the duration. */
export function tierOf(plan: Plan): InterviewTierId {
  return PLANS[plan].interviewTier;
}

/** The caller's own standing, for Server Components. Identity from the session. */
export async function currentUsageSummary(now = new Date()): Promise<UsageSummary> {
  const userId = await requireUserId();
  return usageSummary(userId, now);
}

/** The caller's own plan, for Server Components. Identity from the session. */
export async function currentPlan(): Promise<PlanId> {
  const userId = await requireUserId();
  return fetchPlan(userId);
}

/** The two page-facing views of a summary, with dates as ISO strings for the client. */
export function analysisQuotaView(summary: UsageSummary): AnalysisQuotaView {
  return {
    plan: summary.plan,
    left: summary.analyses.left,
    limit: summary.analyses.limit,
    announce: summary.analyses.announce,
    resetsAt: summary.resetsAt.toISOString(),
  };
}

export function interviewQuotaView(summary: UsageSummary): InterviewQuotaView {
  return {
    plan: summary.plan,
    trialAvailable: summary.trial.available,
    left: summary.interviews.left,
    limit: summary.interviews.limit,
    resetsAt: summary.resetsAt.toISOString(),
  };
}
