import "server-only";

import { Prisma, type UsageKind } from "@prisma/client";
import { cache } from "react";
import prisma from "@/lib/prisma";
import { getOptionalUserIdOutsideProxy, requireUserId } from "@/lib/auth";
import { quotaPeriodFor, type PlanStanding, type SubscriptionStanding } from "@/lib/billing/access";
import { reconcileIfStale } from "@/lib/billing/reconcile";
import type { CheckoutItem } from "@/lib/billing/types";
import {
  AnalysisQuotaExceededError,
  InterviewQuotaExceededError,
} from "@/lib/error/errors";
import { handleError } from "@/lib/error/handleError";
import {
  decideEntitlement,
  tierOfAgent,
  trialOpen,
  USAGE_KIND_BY_SOURCE,
  type EntitlementFacts,
  type EntitlementSource,
  type InterviewEntitlement,
  type TrialBlock,
} from "@/lib/interviewEntitlement";
import type { TrialIdentity } from "@/lib/trialClaim";
import { trialIdentityFor } from "@/lib/trialIdentity";
import {
  INTERVIEW_TIERS,
  PLANS,
  type AnalysisQuotaView,
  type InterviewQuotaView,
  type InterviewTierId,
  type PlanId,
  type QuotaPeriod,
} from "@/lib/plans";
import { findBillingCustomer, listSubscriptionRows, resolvePlanStanding, resolvePlanStandingIn, transactionApplied } from "./billing";
import { creditBalanceIn } from "./credits";
import { expireAbandonedInterviews } from "./interviewExpiry";

/**
 * The usage ledger. No session here: the callers are the actions (which
 * resolved the session and pass their own id), the session endpoint, the
 * post-call path (which has no session and refunds by event id) and the
 * billing webhook (credits). Every read and write is scoped by the user id
 * it was given.
 *
 * The primitives, and nothing else touches the table: `reserveAnalysis`
 * (check and insert in one serializable transaction), `settleAnalysisUnitIn`
 * (the unit spent for good, in the transaction that saves its row),
 * `refundAbandonedAnalyses` (the daily sweep of units whose request died),
 * `reserveInterview` (the unit the entitlement names, same discipline; a
 * trial also claims its verified emails, TrialClaim, freed by its refund),
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
const LOG = "[CVision][usage]";

/** Why a held analysis unit was given back without its request: the request died before its own catch could. */
export const ABANDONED_REQUEST = "ABANDONED_REQUEST";

/**
 * A held analysis unit this old was not held by a live request: the upload page's maxDuration is 100 s. The sweep
 * waits far longer than that, so a slow request is never raced; the settle guard makes a race harmless anyway.
 */
export const ABANDONED_ANALYSIS_MS = 60 * 60_000;

/** An analysis unit's refId: the analysis id, or `<analysisId>#<n>` for a later unit of the same submission. */
const ANALYSIS_REF = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(#\d+)?$/i;

export type Reservation = { eventId: string };

export type AnalysisReservation =
  | ({ kind: "reserved" } & Reservation)
  /** An earlier request for the same submission holds a live unit and may still save the analysis: nothing was taken. */
  | { kind: "in-flight" };

/** The unique index "UsageEvent_one_live_trial" refused the insert; the (kind, refId) unique is a different collision. */
export function isLiveTrialConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  const names = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return names.length > 0 && !names.includes("refId");
}

/** A TrialClaim insert collided with an existing claim: another account of the same email took the trial first. */
function isTrialClaimConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (error.meta?.modelName === "TrialClaim") return true;
  const target = error.meta?.target;
  const names = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return names.includes("emailHash") || names.includes("TrialClaim_pkey");
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
 * Takes the unit of one analysis, or throws the typed refusal with the reset
 * date. The count and the insert run under serializable isolation and the
 * loser of a race retries, so the last unit is taken once.
 *
 * `refId` is the analysis id, which the action derives from the submission:
 * a retry of the same submission names the same analysis. While an earlier
 * request for it holds a live unit younger than `inFlightMs` (the longest a
 * request can live), nothing is taken and the caller waits for that
 * request's row instead of paying for a second one. An older unit that was
 * never settled belonged to a request killed before its catch ran (its row
 * was never saved): it is given back in the same transaction, before the
 * count. A settled one (its analysis deleted since) and a refunded one stay
 * as they are. Either way a new unit is taken under `<analysisId>#<n>`, n
 * counting every earlier one: `(kind, refId)` is unique and refunds mark,
 * never delete.
 */
export async function reserveAnalysis(
  userId: string,
  analysisId: string,
  inFlightMs: number,
  now = new Date(),
): Promise<AnalysisReservation> {
  try {
    return await serializable(async (tx) => {
      const earlier = await tx.usageEvent.findMany({
        where: { userId, kind: "ANALYSIS", refId: { startsWith: analysisId } },
        select: { id: true, createdAt: true, refundedAt: true, settledAt: true },
      });
      const held = earlier.filter((event) => event.refundedAt === null);
      if (held.some((event) => now.getTime() - event.createdAt.getTime() < inFlightMs)) return { kind: "in-flight" as const };

      // Older than any request can live and never settled: its request died without saving, so it is not charged.
      const dead = held.filter((event) => event.settledAt === null).map((event) => event.id);
      if (dead.length > 0) {
        const given = await tx.usageEvent.updateMany({
          where: { id: { in: dead }, refundedAt: null, settledAt: null },
          data: { refundedAt: now, refundReason: ABANDONED_REQUEST },
        });
        if (given.count > 0) console.info(`${LOG} analysis unit(s) of a dead request refunded on retry: user=${userId} analysis=${analysisId} events=${dead.join(",")}`);
      }

      const standing = await resolvePlanStandingIn(tx, userId, now);
      const period = quotaPeriodFor(standing, now);
      const used = await tx.usageEvent.count({
        where: { userId, kind: "ANALYSIS", refundedAt: null, createdAt: { gte: period.start, lt: period.end } },
      });
      if (used >= PLANS[standing.plan].analysesPerMonth) {
        throw new AnalysisQuotaExceededError({ plan: standing.plan, resetsAt: period.end.toISOString() });
      }

      const refId = earlier.length === 0 ? analysisId : `${analysisId}#${earlier.length + 1}`;
      const event = await tx.usageEvent.create({
        data: { userId, kind: "ANALYSIS", refId, createdAt: now },
        select: { id: true },
      });
      return { kind: "reserved" as const, eventId: event.id };
    });
  } catch (error) {
    handleError(error, "Failed to reserve an analysis");
  }
}

/**
 * Spends an analysis unit for good, on the client of the transaction that saves the row it pays for (createResume):
 * false when the unit is no longer held (given back by the sweep, by a retry of the same submission, or refunded),
 * and the caller must then save nothing. One conditional update, so it and a refund of the same unit cannot both
 * win; in the insert's transaction, so a unit is never spent without its row: an insert that fails rolls the settle
 * back with it, and the unit is still held for the request's own refund.
 */
export async function settleAnalysisUnitIn(
  db: Prisma.TransactionClient,
  { eventId, userId }: { eventId: string; userId: string },
  now = new Date(),
): Promise<boolean> {
  const result = await db.usageEvent.updateMany({
    where: { id: eventId, userId, kind: "ANALYSIS", refundedAt: null, settledAt: null },
    data: { settledAt: now },
  });
  return result.count === 1;
}

export type AbandonedAnalysesReport = {
  /** Held units old enough to look at. */
  examined: number;
  refunded: number;
  /** Held units whose analysis row exists (saved by a deploy that did not settle yet): marked spent, never refunded. */
  settled: number;
};

/**
 * Gives back the analysis units whose request died before it could: held (neither refunded nor settled), older
 * than `ABANDONED_ANALYSIS_MS`, and with no analysis row under their id. Runs from the daily cron, across users,
 * at most `limit` units a run (the oldest first; the next run takes the rest). The refund is one conditional
 * update over the ids, so a unit that its request settled meanwhile is not touched; and a request that comes back
 * after its unit was given back finds it unsettleable and saves nothing. One log line per refund, ids only.
 */
export async function refundAbandonedAnalyses(now = new Date(), { limit = 500 }: { limit?: number } = {}): Promise<AbandonedAnalysesReport> {
  try {
    const cutoff = new Date(now.getTime() - ABANDONED_ANALYSIS_MS);
    // The predicate of the partial index "UsageEvent_held_analysis", word for word, so the planner can use it. Prisma
    // sends an enum as CAST($1::text AS "UsageKind"), which it cannot prove equal to 'ANALYSIS' (enum_in is not
    // immutable): measured, a findMany never picks that index. Fixed SQL, only the cutoff and the limit as parameters.
    const held = await prisma.$queryRaw<{ id: string; refId: string }[]>`
      SELECT "id", "refId" FROM "UsageEvent"
      WHERE "kind" = 'ANALYSIS' AND "refundedAt" IS NULL AND "settledAt" IS NULL AND "createdAt" < ${cutoff}
      ORDER BY "createdAt" ASC
      LIMIT ${limit}`;
    const units = held.flatMap((event) => {
      const analysisId = ANALYSIS_REF.exec(event.refId)?.[1];
      return analysisId ? [{ id: event.id, analysisId }] : [];
    });
    if (units.length === 0) return { examined: held.length, refunded: 0, settled: 0 };

    const ids = [...new Set(units.map((unit) => unit.analysisId))];
    const saved = new Set((await prisma.resumeAnalysis.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((row) => row.id));
    const withRow = units.filter((unit) => saved.has(unit.analysisId)).map((unit) => unit.id);
    const withoutRow = units.filter((unit) => !saved.has(unit.analysisId)).map((unit) => unit.id);

    const settled = withRow.length
      ? (await prisma.usageEvent.updateMany({ where: { id: { in: withRow }, refundedAt: null, settledAt: null }, data: { settledAt: now } })).count
      : 0;
    const refunded = withoutRow.length
      ? await prisma.usageEvent.updateManyAndReturn({
          where: { id: { in: withoutRow }, refundedAt: null, settledAt: null },
          data: { refundedAt: now, refundReason: ABANDONED_REQUEST },
          select: { id: true, userId: true, refId: true, createdAt: true },
        })
      : [];
    for (const unit of refunded) {
      const ageMinutes = Math.round((now.getTime() - unit.createdAt.getTime()) / 60_000);
      console.info(`${LOG} abandoned analysis unit refunded: event=${unit.id} user=${unit.userId} ref=${unit.refId} age=${ageMinutes}min`);
    }
    return { examined: held.length, refunded: refunded.length, settled };
  } catch (error) {
    handleError(error, "Failed to refund abandoned analysis units");
  }
}

/**
 * Gives a unit back, once: a second refund of the same event changes nothing. A refunded credit is a credit again;
 * a refunded trial frees the email claims its reservation wrote, in the same transaction.
 */
export async function refundUsage(eventId: string, reason: string): Promise<boolean> {
  try {
    return await prisma.$transaction((tx) => refundUsageIn(tx, eventId, reason));
  } catch (error) {
    handleError(error, "Failed to refund usage");
  }
}

/** The refund on the transaction given, for a caller that pairs it with another write. */
export async function refundUsageIn(db: Prisma.TransactionClient, eventId: string, reason: string): Promise<boolean> {
  const refunded = await db.usageEvent.updateManyAndReturn({
    where: { id: eventId, refundedAt: null },
    data: { refundedAt: new Date(), refundReason: reason },
    select: { kind: true, trialClaimHashes: true },
  });
  if (refunded.length !== 1) return false;
  const [unit] = refunded;
  // The trial was not spent: the emails it claimed may take it again.
  if (unit.kind === "INTERVIEW_TRIAL" && unit.trialClaimHashes.length > 0) {
    await db.trialClaim.deleteMany({ where: { emailHash: { in: unit.trialClaimHashes } } });
  }
  return true;
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

/** Supplies the account's trial identity (its verified emails' claim hashes) when the trial's check needs it. */
type TrialIdentitySource = () => Promise<TrialIdentity>;

/** The trial's block from the claims table: any of the account's hashes claimed, or an identity that could not be read. */
async function trialBlockIn(db: Prisma.TransactionClient, identity: TrialIdentity): Promise<TrialBlock | null> {
  if (identity.kind === "unavailable") return "unavailable";
  const claimed = await db.trialClaim.findFirst({ where: { emailHash: { in: identity.hashes } }, select: { emailHash: true } });
  return claimed ? "claimed" : null;
}

/**
 * The facts with the trial's email check, made only when the account would otherwise have its trial (a Free
 * account that never had voice and never used it): Pro, credit holders past their trial and accounts that had
 * voice never reach Clerk for it.
 */
async function withTrialBlock(db: Prisma.TransactionClient, facts: EntitlementFacts, identity: TrialIdentitySource): Promise<EntitlementFacts> {
  if (!trialOpen(facts)) return facts;
  return { ...facts, trialBlock: await trialBlockIn(db, await identity()) };
}

/** The same decision for a page: the room's label before the first token, and anything else that shows what a start would get. */
export async function resolveInterviewEntitlement(
  userId: string,
  now = new Date(),
  identity: TrialIdentitySource = () => trialIdentityFor(userId),
): Promise<InterviewEntitlement> {
  try {
    const standing = await resolvePlanStanding(userId, now);
    const { facts } = await entitlementFactsIn(prisma, userId, standing, now);
    return decideEntitlement(await withTrialBlock(prisma, facts, identity));
  } catch (error) {
    handleError(error, `Failed to resolve the interview entitlement (user=${userId})`);
  }
}

/** The reservation's first pass found the trial open without the identity in hand: read it outside the transaction. */
const NEEDS_IDENTITY = Symbol("needs-identity");

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
 *
 * A trial also claims every verified email of the account (TrialClaim, one
 * row per hash, the hashes kept on the unit so its refund frees them), in
 * the same transaction: an email another account claimed first is the
 * quota refusal, never a crash. The identity needs Clerk, which never runs
 * inside the transaction: when the trial would pay and the identity is not
 * in hand, the first pass writes nothing and the identity is read before
 * the second.
 */
export async function reserveInterview(
  userId: string,
  interviewId: string,
  now = new Date(),
  identitySource: TrialIdentitySource = () => trialIdentityFor(userId, { fresh: true }),
): Promise<InterviewReservation> {
  try {
    let identity: TrialIdentity | null = null;
    for (let pass = 0; pass < 2; pass += 1) {
      const outcome = await serializable(async (tx) => {
        const standing = await resolvePlanStandingIn(tx, userId, now);
        const { facts } = await entitlementFactsIn(tx, userId, standing, now);
        // Only a start the trial would pay for needs the emails: a credit or a period interview never reads them.
        const unchecked = decideEntitlement(facts);
        if (unchecked.source === "trial" && identity === null) return NEEDS_IDENTITY;
        const entitlement = unchecked.source === "trial" && identity ? decideEntitlement({ ...facts, trialBlock: await trialBlockIn(tx, identity) }) : unchecked;
        const refuse = () =>
          new InterviewQuotaExceededError({ plan: entitlement.plan, ...(entitlement.resetsAt ? { resetsAt: entitlement.resetsAt } : {}) });
        if (entitlement.source === "none") throw refuse();
        const kind = USAGE_KIND_BY_SOURCE[entitlement.source];
        const tier = tierOfAgent(entitlement.agent ?? "main");

        // A trial is chosen only with an identity whose emails are unclaimed (decideEntitlement).
        const trialClaimHashes = kind === "INTERVIEW_TRIAL" && identity?.kind === "emails" ? identity.hashes : [];
        if (kind === "INTERVIEW_TRIAL" && trialClaimHashes.length === 0) throw refuse();
        if (trialClaimHashes.length > 0) {
          await tx.trialClaim.createMany({ data: trialClaimHashes.map((emailHash) => ({ emailHash, createdAt: now })) }).catch((error: unknown) => {
            // Another account of the same email took its trial between the read and this insert.
            if (isTrialClaimConflict(error)) throw refuse();
            throw error;
          });
        }

        const refunded = await tx.usageEvent.count({ where: { kind, refId: { startsWith: interviewId }, refundedAt: { not: null } } });
        const event = await tx.usageEvent
          .create({
            data: { userId, kind, refId: refunded === 0 ? interviewId : `${interviewId}#${refunded + 1}`, createdAt: now, ...(trialClaimHashes.length > 0 ? { trialClaimHashes } : {}) },
            select: { id: true },
          })
          .catch((error: unknown) => {
            // The database holds one live trial per account (a partial unique index): a second one is a refusal, not a crash.
            if (kind === "INTERVIEW_TRIAL" && isLiveTrialConflict(error)) throw refuse();
            throw error;
          });
        return { eventId: event.id, kind, tier, seconds: INTERVIEW_TIERS[tier].seconds, source: entitlement.source };
      });
      if (outcome !== NEEDS_IDENTITY) return outcome;
      identity = await identitySource();
    }
    throw new Error("unreachable: the trial identity was read and the reservation asked for it again");
  } catch (error) {
    handleError(error, "Failed to reserve the interview unit");
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
  /** Pack credits held, and those held by interviews still in progress (back when those end without an answer). */
  credits: { balance: number; pending: number };
  /** `blocked`: the account's own trial is kept away by its email's claim, or by a check that could not run. */
  trial: { available: boolean; used: boolean; blocked?: TrialBlock | null };
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

    const [{ period, facts: ledgerFacts, analysesUsed }, customer] = await Promise.all([entitlementFactsIn(prisma, userId, standing, now), findBillingCustomer(userId)]);
    // A third wave, only for an account whose own trial is still open: its emails against the claims.
    const facts = await withTrialBlock(prisma, ledgerFacts, () => trialIdentityFor(userId));
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
      credits: { balance: facts.credits, pending: ledgerFacts.creditsPending },
      trial: {
        used: facts.trialsUsed > 0,
        available: entitlement.remaining.trial > 0,
        ...(facts.trialBlock ? { blocked: facts.trialBlock } : {}),
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

/**
 * The signed-in caller's plan, for the shell's header (its account menu offers Pricing to everyone but Pro);
 * null signed out, or when it cannot be read: a header never takes a page down. Without Clerk's middleware (a
 * missing static file renders the not-found page) reading the session throws: no plan either.
 */
export const currentShellPlan: () => Promise<PlanId | null> = cache(async () => {
  const userId = await getOptionalUserIdOutsideProxy();
  if (!userId) return null;
  try {
    return (await resolvePlanStanding(userId)).plan;
  } catch {
    // resolvePlanStanding logged it.
    return null;
  }
});

/** What the caller's next interview start would get, once per request. */
export const currentInterviewEntitlement: () => Promise<InterviewEntitlement> = cache(async () => resolveInterviewEntitlement(await requireUserId()));

/** The caller's subscription still open (not canceled), if any: a new Pro checkout would refuse. */
export const currentOpenSubscriptionStatus: () => Promise<SubscriptionStanding["status"] | null> = cache(
  async () => (await listSubscriptionRows(await requireUserId())).find((row) => row.status !== "CANCELED")?.status ?? null,
);

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
