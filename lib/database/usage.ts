import "server-only";

import { Prisma, type Plan, type UsageKind } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { quotaPeriodFor, type PlanStanding } from "@/lib/billing/access";
import { reconcileIfStale } from "@/lib/billing/reconcile";
import {
  AnalysisQuotaExceededError,
  InterviewQuotaExceededError,
  type ErrorMeta,
} from "@/lib/error/errors";
import { handleError } from "@/lib/error/handleError";
import {
  INTERVIEW_TIERS,
  PLANS,
  type AnalysisQuotaView,
  type InterviewQuotaView,
  type InterviewTierId,
  type PlanId,
  type QuotaPeriod,
} from "@/lib/plans";
import { findBillingCustomer, resolvePlanStanding, resolvePlanStandingIn, transactionApplied } from "./billing";
import { expireAbandonedInterviews } from "./interviewExpiry";

/**
 * The usage ledger. No session here: the callers are the actions (which
 * resolved the session and pass their own id), the session endpoint, the
 * post-call path (which has no session and refunds by event id) and the
 * billing webhook (credits). Every read and write is scoped by the user id
 * it was given.
 *
 * The primitives, and nothing else touches the table: `reserveUsage`
 * (analyses: check and insert in one serializable transaction),
 * `reserveInterview` (the plan's interview, a credit, or the trial, same
 * discipline), `refundUsage`, and for the credits `grantInterviewCredits`,
 * `revokeUnusedInterviewCredits` and `interviewCreditBalance`. The plan is
 * never read from a column: it is derived (lib/billing/access.ts) inside
 * the same transaction as the count, and its period is the billing period
 * for a subscribed Pro. The expiry module imports `refundUsage` and this
 * file imports the expiry: a deliberate cycle of call-time bindings (see
 * interviewExpiry.ts).
 */

const RACE_CODES = new Set(["P2034"]);
const UNIQUE_VIOLATION = "P2002";
const RESERVE_ATTEMPTS = 3;

export type Reservation = { eventId: string };

type Allowance = {
  limit: number;
  /** Null for a lifetime quota (the trial). */
  period: QuotaPeriod | null;
};

/** The kinds a plain reservation can be made of; interviews go through `reserveInterview`, grants and revokes are the webhook's. */
function allowanceFor(standing: PlanStanding, kind: UsageKind, now: Date): Allowance {
  const limits = PLANS[standing.plan];
  switch (kind) {
    case "ANALYSIS":
      return { limit: limits.analysesPerMonth, period: quotaPeriodFor(standing, now) };
    case "INTERVIEW":
      return { limit: limits.interviewsPerMonth, period: quotaPeriodFor(standing, now) };
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

/** Runs a serializable transaction, retrying the loser of a serialization race. */
async function serializable<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let round = 0; round < RESERVE_ATTEMPTS; round += 1) {
    try {
      return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const raced = error instanceof Prisma.PrismaClientKnownRequestError && RACE_CODES.has(error.code);
      if (!raced || round === RESERVE_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error("unreachable");
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
    return await serializable(async (tx) => {
      const standing = await resolvePlanStandingIn(tx, userId, now);
      const allowance = allowanceFor(standing, kind, now);

      const used = await tx.usageEvent.count({
        where: {
          userId,
          kind,
          refundedAt: null,
          ...(allowance.period ? { createdAt: { gte: allowance.period.start, lt: allowance.period.end } } : {}),
        },
      });
      if (used >= allowance.limit) refusal(standing.plan, kind, allowance);

      const event = await tx.usageEvent.create({
        data: { userId, kind, refId, createdAt: now },
        select: { id: true },
      });
      return { eventId: event.id };
    });
  } catch (error) {
    handleError(error, "Failed to reserve usage");
  }
}

/** Gives a unit back, once: a second refund of the same event changes nothing. A refunded credit is a credit again. */
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

/** Whether the account ever had voice: a subscription at any time, or a full interview paid any way. */
async function hadVoiceIn(tx: Prisma.TransactionClient, userId: string, standing: PlanStanding): Promise<boolean> {
  if (standing.everSubscribed) return true;
  const full = await tx.usageEvent.count({
    where: { userId, kind: { in: ["INTERVIEW", "INTERVIEW_CREDIT"] }, refundedAt: null },
  });
  return full > 0;
}

/**
 * The interview unit for the user, in one serializable transaction: a Pro
 * takes one of the period's interviews, and when those are used, one pack
 * credit; a Free account takes a pack credit if it holds any (a full
 * interview on the main agent: paid-for credits are usable on any plan),
 * else its one lifetime trial, which exists only for an account that never
 * had voice (never subscribed, never ran a full interview). The kind
 * decides the agent.
 */
export async function reserveInterview(userId: string, interviewId: string, now = new Date()): Promise<InterviewReservation> {
  try {
    return await serializable(async (tx) => {
      const standing = await resolvePlanStandingIn(tx, userId, now);
      const take = async (kind: UsageKind, tier: InterviewTierId): Promise<InterviewReservation> => {
        const event = await tx.usageEvent.create({
          data: { userId, kind, refId: interviewId, createdAt: now },
          select: { id: true },
        });
        return { eventId: event.id, kind, tier, seconds: INTERVIEW_TIERS[tier].seconds };
      };

      if (standing.plan === "PRO") {
        const period = quotaPeriodFor(standing, now);
        const used = await tx.usageEvent.count({
          where: { userId, kind: "INTERVIEW", refundedAt: null, createdAt: { gte: period.start, lt: period.end } },
        });
        if (used < PLANS.PRO.interviewsPerMonth) return take("INTERVIEW", "FULL");
        if ((await creditBalanceIn(tx, userId)) > 0) return take("INTERVIEW_CREDIT", "FULL");
        throw new InterviewQuotaExceededError({ plan: "PRO", resetsAt: period.end.toISOString() });
      }

      if ((await creditBalanceIn(tx, userId)) > 0) return take("INTERVIEW_CREDIT", "FULL");

      const trials = await tx.usageEvent.count({ where: { userId, kind: "INTERVIEW_TRIAL", refundedAt: null } });
      const available = trials < PLANS.FREE.trialInterviews && !(await hadVoiceIn(tx, userId, standing));
      if (!available) throw new InterviewQuotaExceededError({ plan: "FREE" });
      return take("INTERVIEW_TRIAL", "TRIAL");
    });
  } catch (error) {
    handleError(error, "Failed to reserve the interview unit");
  }
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

/**
 * One query: the units of every grant and revoke, and of every consumption
 * not given back (a consumption is one unit), grouped by kind. Every round
 * trip to the pooler costs hundreds of milliseconds from far away, and this
 * runs inside the interview reservation and on every status poll.
 */
async function creditBalanceIn(db: Prisma.TransactionClient, userId: string): Promise<number> {
  const rows = await db.usageEvent.groupBy({
    by: ["kind"],
    where: {
      userId,
      OR: [{ kind: { in: ["INTERVIEW_CREDIT_GRANT", "INTERVIEW_CREDIT_REVOKE"] } }, { kind: "INTERVIEW_CREDIT", refundedAt: null }],
    },
    _sum: { units: true },
  });
  const units = (kind: UsageKind) => rows.find((row) => row.kind === kind)?._sum.units ?? 0;
  return Math.max(0, units("INTERVIEW_CREDIT_GRANT") - units("INTERVIEW_CREDIT_REVOKE") - units("INTERVIEW_CREDIT"));
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
    return await serializable(async (tx) => {
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
    });
  } catch (error) {
    handleError(error, `Failed to revoke interview credits (user=${userId}, adjustment=${adjustmentId})`);
  }
}

export type UsageSummary = {
  plan: PlanId;
  /** Where the plan comes from: a subscription, a manual comp, or nothing. */
  source: PlanStanding["source"];
  analyses: { used: number; limit: number; left: number; announce: boolean };
  interviews: { used: number; limit: number; left: number };
  /** Pack credits held: each one a full interview, on any plan, after a Pro's period interviews. */
  credits: { balance: number };
  trial: { available: boolean; used: boolean };
  /** The current quota period: the billing period of a subscribed Pro, the UTC month otherwise. */
  period: QuotaPeriod;
  /** When the period's counters reset: its end. */
  resetsAt: Date;
  /** The subscription the standing rests on, or the latest one, for the account page. */
  subscription: PlanStanding["subscription"];
  everSubscribed: boolean;
  /** Has a customer at the billing provider (checked out at least once): the portal exists for them. */
  hasBillingAccount: boolean;
};

/**
 * The user's standing against every quota, for the pages that show it and
 * the actions that pre-check it. Reading a quota is also the sweep for
 * abandoned interviews (so a reservation nobody came back to is given back
 * before it is counted) and, when the mirrored subscription looks behind
 * the provider, the lazy reconcile.
 */
export async function usageSummary(userId: string, now = new Date()): Promise<UsageSummary> {
  try {
    await expireAbandonedInterviews(userId, now);

    let standing = await resolvePlanStanding(userId, now);
    if (await reconcileIfStale(userId, standing, now)) standing = await resolvePlanStanding(userId, now);

    const { plan } = standing;
    const limits = PLANS[plan];
    const period = quotaPeriodFor(standing, now);

    const countOf = (kinds: UsageKind[], inPeriod: boolean) =>
      prisma.usageEvent.count({
        where: {
          userId,
          kind: { in: kinds },
          refundedAt: null,
          ...(inPeriod ? { createdAt: { gte: period.start, lt: period.end } } : {}),
        },
      });
    const [analyses, interviews, trials, fullEver, credits, customer] = await Promise.all([
      countOf(["ANALYSIS"], true),
      countOf(["INTERVIEW"], true),
      countOf(["INTERVIEW_TRIAL"], false),
      countOf(["INTERVIEW", "INTERVIEW_CREDIT"], false),
      creditBalanceIn(prisma, userId),
      findBillingCustomer(userId),
    ]);
    const hadVoice = standing.everSubscribed || fullEver > 0;

    return {
      plan,
      source: standing.source,
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
      credits: { balance: credits },
      trial: {
        used: trials > 0,
        available: plan === "FREE" && trials < limits.trialInterviews && !hadVoice,
      },
      period,
      resetsAt: period.end,
      subscription: standing.subscription,
      everSubscribed: standing.everSubscribed,
      hasBillingAccount: customer !== null,
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

/** Whether a checkout the caller paid has landed, for the account page's first render. Identity from the session. */
export async function currentTransactionApplied(transactionId: string): Promise<boolean> {
  const userId = await requireUserId();
  return transactionApplied(userId, transactionId);
}

export type BillingStatus = {
  plan: PlanId;
  subscription: PlanStanding["subscription"];
  /** The current quota period's end. */
  periodEnd: Date;
  credits: number;
  /** Whether the named transaction was applied; null when none was named. */
  transactionApplied: boolean | null;
};

/**
 * What the account page polls after a checkout, every few seconds: the
 * plan, the credits, and whether the transaction it waits for has been
 * applied. Deliberately lean, and deliberately not `usageSummary`: no
 * sweep of abandoned interviews, no lazy reconcile (so a poll never
 * reaches the provider), and every read in one parallel wave, because a
 * round trip to the pooler is the cost here, not the query.
 */
export async function billingStatus(userId: string, transactionId: string | null, now = new Date()): Promise<BillingStatus> {
  try {
    const [standing, credits, applied] = await Promise.all([
      resolvePlanStanding(userId, now),
      creditBalanceIn(prisma, userId),
      transactionId ? transactionApplied(userId, transactionId) : Promise.resolve(null),
    ]);
    return {
      plan: standing.plan,
      subscription: standing.subscription,
      periodEnd: quotaPeriodFor(standing, now).end,
      credits,
      transactionApplied: applied,
    };
  } catch (error) {
    handleError(error, "Failed to read the billing status");
  }
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
    credits: summary.credits.balance,
    resetsAt: summary.resetsAt.toISOString(),
  };
}
