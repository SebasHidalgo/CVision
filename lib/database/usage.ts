import "server-only";

import { Prisma, type UsageKind } from "@prisma/client";
import { cache } from "react";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { quotaPeriodFor, type PlanStanding } from "@/lib/billing/access";
import { reconcileIfStale } from "@/lib/billing/reconcile";
import type { CheckoutItem } from "@/lib/billing/types";
import {
  AnalysisQuotaExceededError,
  InterviewQuotaExceededError,
  type ErrorMeta,
} from "@/lib/error/errors";
import { handleError } from "@/lib/error/handleError";
import {
  decideEntitlement,
  tierOfAgent,
  USAGE_KIND_BY_SOURCE,
  type EntitlementSource,
  type InterviewEntitlement,
} from "@/lib/interviewEntitlement";
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
import { creditBalanceIn } from "./credits";
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
 * `reserveInterview` (the unit the entitlement names, same discipline),
 * `refundUsage`, `revokeUnusedInterviewCredits`, and in credits.ts (no
 * `lib/auth` in its graph, for the reconcile script) the credit balance
 * and the grant. The plan is never read from a column: it is derived
 * (lib/billing/access.ts) inside the same transaction as the count, and
 * its period is the billing period for a subscribed Pro. Which interview
 * the next start gets is decided once, by `decideEntitlement`
 * (lib/interviewEntitlement.ts), on facts read here: the reservation runs
 * it inside its transaction and every page reads it from the same facts.
 * The expiry module imports `refundUsage` and this file imports the
 * expiry: a deliberate cycle of call-time bindings (see interviewExpiry.ts).
 */

const RACE_CODES = new Set(["P2034"]);
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
    return await refundUsageIn(prisma, eventId, reason);
  } catch (error) {
    handleError(error, "Failed to refund usage");
  }
}

/** The refund on the client given (a transaction, or the pool), for a caller that pairs it with another write. */
export async function refundUsageIn(db: Prisma.TransactionClient, eventId: string, reason: string): Promise<boolean> {
  const result = await db.usageEvent.updateMany({
    where: { id: eventId, refundedAt: null },
    data: { refundedAt: new Date(), refundReason: reason },
  });
  return result.count === 1;
}

/**
 * The facts the entitlement is decided on, in one parallel wave of three
 * reads on the client given (a transaction, or the pool): the period's
 * analyses and interviews grouped by kind; the lifetime ledger grouped by
 * kind (grants and revokes by units, trials, full interviews and credit
 * consumptions by count, refunded ones excluded); and the credits held by
 * interviews still in progress. Three reads because every round trip to
 * the pooler costs hundreds of milliseconds from far away, and the pool
 * holds five connections: a wave of three stays one wave.
 */
async function entitlementFactsIn(db: Prisma.TransactionClient, userId: string, standing: PlanStanding, now: Date) {
  const period = quotaPeriodFor(standing, now);
  const [inPeriod, ever, creditsPending] = await Promise.all([
    db.usageEvent.groupBy({
      by: ["kind"],
      where: { userId, refundedAt: null, kind: { in: ["ANALYSIS", "INTERVIEW"] }, createdAt: { gte: period.start, lt: period.end } },
      _count: { _all: true },
    }),
    db.usageEvent.groupBy({
      by: ["kind"],
      where: {
        userId,
        OR: [
          { kind: { in: ["INTERVIEW_CREDIT_GRANT", "INTERVIEW_CREDIT_REVOKE"] } },
          { kind: { in: ["INTERVIEW_CREDIT", "INTERVIEW", "INTERVIEW_TRIAL"] }, refundedAt: null },
        ],
      },
      _count: { _all: true },
      _sum: { units: true },
    }),
    db.interview.count({ where: { userId, status: "IN_PROGRESS", paidBy: "CREDIT", usageEventId: { not: null } } }),
  ]);
  const countIn = (rows: { kind: UsageKind; _count: { _all: number } }[], kind: UsageKind) => rows.find((row) => row.kind === kind)?._count._all ?? 0;
  const unitsEver = (kind: UsageKind) => ever.find((row) => row.kind === kind)?._sum.units ?? 0;
  const credits = Math.max(0, unitsEver("INTERVIEW_CREDIT_GRANT") - unitsEver("INTERVIEW_CREDIT_REVOKE") - unitsEver("INTERVIEW_CREDIT"));
  return {
    period,
    analysesUsed: countIn(inPeriod, "ANALYSIS"),
    facts: {
      plan: standing.plan,
      periodUsed: countIn(inPeriod, "INTERVIEW"),
      credits,
      creditsPending,
      trialsUsed: countIn(ever, "INTERVIEW_TRIAL"),
      hadVoice: standing.everSubscribed || countIn(ever, "INTERVIEW") + countIn(ever, "INTERVIEW_CREDIT") > 0,
      periodEnd: period.end,
    },
  };
}

/** What the next interview start would get, decided on the facts read inside the caller's transaction. */
export async function resolveInterviewEntitlementIn(tx: Prisma.TransactionClient, userId: string, now = new Date()): Promise<InterviewEntitlement> {
  const standing = await resolvePlanStandingIn(tx, userId, now);
  const { facts } = await entitlementFactsIn(tx, userId, standing, now);
  return decideEntitlement(facts);
}

/** The same decision for a page: the room's label before the first token, and anything else that shows what a start would get. */
export async function resolveInterviewEntitlement(userId: string, now = new Date()): Promise<InterviewEntitlement> {
  try {
    const standing = await resolvePlanStanding(userId, now);
    const { facts } = await entitlementFactsIn(prisma, userId, standing, now);
    return decideEntitlement(facts);
  } catch (error) {
    handleError(error, `Failed to resolve the interview entitlement (user=${userId})`);
  }
}

export type InterviewReservation = Reservation & {
  kind: UsageKind;
  tier: InterviewTierId;
  seconds: number;
  source: Exclude<EntitlementSource, "none">;
};

/**
 * The interview unit for the user, in one serializable transaction: the
 * entitlement is decided inside it, on the same facts the reservation
 * writes against, so what the room was told and what the first token takes
 * cannot diverge. The source decides the ledger kind and the agent.
 *
 * `refId` is the interview id. A refunded reservation stays on the ledger
 * (refunds mark, never delete) and `(kind, refId)` is unique, so a start
 * after a silent, lost or failed call takes a new row under
 * `<interviewId>#<n>`, n counting the refunded ones before it: every
 * reservation keeps its row, and the retry the refund promised can happen.
 * An active reservation under the same id still collides, as it should.
 */
export async function reserveInterview(userId: string, interviewId: string, now = new Date()): Promise<InterviewReservation> {
  try {
    return await serializable(async (tx) => {
      const entitlement = await resolveInterviewEntitlementIn(tx, userId, now);
      if (entitlement.source === "none") {
        throw new InterviewQuotaExceededError({ plan: entitlement.plan, ...(entitlement.resetsAt ? { resetsAt: entitlement.resetsAt } : {}) });
      }
      const kind = USAGE_KIND_BY_SOURCE[entitlement.source];
      const tier = tierOfAgent(entitlement.agent ?? "main");
      const refunded = await tx.usageEvent.count({ where: { kind, refId: { startsWith: interviewId }, refundedAt: { not: null } } });
      const event = await tx.usageEvent.create({
        data: { userId, kind, refId: refunded === 0 ? interviewId : `${interviewId}#${refunded + 1}`, createdAt: now },
        select: { id: true },
      });
      return { eventId: event.id, kind, tier, seconds: INTERVIEW_TIERS[tier].seconds, source: entitlement.source };
    });
  } catch (error) {
    handleError(error, "Failed to reserve the interview unit");
  }
}

/** The plan in force: an access-granting subscription, else the manual comp, else Free. */
export async function fetchPlan(userId: string, now = new Date()): Promise<PlanId> {
  return (await resolvePlanStanding(userId, now)).plan;
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
  /** Pack credits held, and those held by interviews still in progress (back when those end without an answer). */
  credits: { balance: number; pending: number };
  trial: { available: boolean; used: boolean };
  /** What the next interview start would get, decided on these same facts. */
  entitlement: InterviewEntitlement;
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
 * the provider, the lazy reconcile. The sweep and the standing are read in
 * one wave (the sweep's refunds only matter to the counts, which come
 * after); the counts, the credits and the customer in the next.
 */
export async function usageSummary(userId: string, now = new Date()): Promise<UsageSummary> {
  try {
    let [, standing] = await Promise.all([expireAbandonedInterviews(userId, now), resolvePlanStanding(userId, now)]);
    if (await reconcileIfStale(userId, standing, now)) standing = await resolvePlanStanding(userId, now);

    const { plan } = standing;
    const limits = PLANS[plan];

    const [{ period, facts, analysesUsed }, customer] = await Promise.all([entitlementFactsIn(prisma, userId, standing, now), findBillingCustomer(userId)]);
    const entitlement = decideEntitlement(facts);

    return {
      plan,
      source: standing.source,
      analyses: {
        used: analysesUsed,
        limit: limits.analysesPerMonth,
        left: Math.max(0, limits.analysesPerMonth - analysesUsed),
        announce: limits.announceAnalyses,
      },
      interviews: {
        used: facts.periodUsed,
        limit: limits.interviewsPerMonth,
        left: entitlement.remaining.period,
      },
      credits: { balance: facts.credits, pending: facts.creditsPending },
      trial: {
        used: facts.trialsUsed > 0,
        available: entitlement.remaining.trial > 0,
      },
      entitlement,
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

/**
 * The session wrappers for Server Components, each memoised for the
 * request with React's `cache`: a page and a component that both need the
 * standing in one render read it once. Identity from the session.
 */
export const currentUsageSummary: () => Promise<UsageSummary> = cache(async () => usageSummary(await requireUserId()));

/** What the caller's next interview start would get, once per request. */
export const currentInterviewEntitlement: () => Promise<InterviewEntitlement> = cache(async () => resolveInterviewEntitlement(await requireUserId()));

/** Whether a checkout the caller paid has landed, for the account page's first render. */
export const currentTransactionApplied: (transactionId: string) => Promise<boolean> = cache(async (transactionId: string) =>
  transactionApplied(await requireUserId(), transactionId),
);

export type BillingStatus = {
  plan: PlanId;
  subscription: PlanStanding["subscription"];
  /** The current quota period's end. */
  periodEnd: Date;
  credits: number;
  /** Whether the named transaction was applied; null when none was named. */
  transactionApplied: boolean | null;
};

export type BillingStatusQuery = {
  /** The checkout the page waits for, when it names one. */
  transactionId: string | null;
  /** What that checkout bought, when the page says: lets a Pro checkout count as applied once Pro is in force by subscription. */
  item: CheckoutItem | null;
};

/**
 * What the account page polls after a checkout, every few seconds: the
 * plan, the credits, and whether the transaction it waits for has been
 * applied. Deliberately lean, and deliberately not `usageSummary`: no
 * sweep of abandoned interviews, no lazy reconcile (so a poll never
 * reaches the provider), and every read in one parallel wave, because a
 * round trip to the pooler is the cost here, not the query.
 *
 * A Pro checkout also counts as applied once the plan is Pro by
 * subscription: only the created event and the completed transaction name
 * the transaction, and if both are lost the activated event still mirrors
 * the subscription. The checkout action refuses Pro while any subscription
 * is open, so the one in force can only be this checkout's.
 */
export async function billingStatus(userId: string, query: BillingStatusQuery, now = new Date()): Promise<BillingStatus> {
  try {
    const [standing, credits, applied] = await Promise.all([
      resolvePlanStanding(userId, now),
      creditBalanceIn(prisma, userId),
      query.transactionId ? transactionApplied(userId, query.transactionId) : Promise.resolve(null),
    ]);
    const proInForce = query.item === "pro_monthly" && standing.plan === "PRO" && standing.source === "subscription";
    return {
      plan: standing.plan,
      subscription: standing.subscription,
      periodEnd: quotaPeriodFor(standing, now).end,
      credits,
      transactionApplied: applied === null ? null : applied || proInForce,
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
    entitlement: summary.entitlement,
    resetsAt: summary.resetsAt.toISOString(),
  };
}
