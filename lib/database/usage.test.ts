import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import type { PlanStanding, SubscriptionStanding } from "@/lib/billing/access";
import { reconcileIfStale } from "@/lib/billing/reconcile";
import { PLANS } from "@/lib/plans";
import { findBillingCustomer, resolvePlanStanding, resolvePlanStandingIn, transactionApplied } from "./billing";
import { expireAbandonedInterviews } from "./interviewExpiry";
import {
  analysisQuotaView,
  billingStatus,
  interviewQuotaView,
  refundUsage,
  reserveInterview,
  reserveUsage,
  resolveInterviewEntitlement,
  revokeUnusedInterviewCredits,
  usageSummary,
} from "./usage";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("./interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn(async () => 0) }));
// The plan is derived (lib/billing/access.ts), read here through the billing data module.
vi.mock("./billing", () => ({
  resolvePlanStanding: vi.fn(),
  resolvePlanStandingIn: vi.fn(),
  findBillingCustomer: vi.fn(async () => null),
  transactionApplied: vi.fn(async () => false),
}));
vi.mock("@/lib/billing/reconcile", () => ({ reconcileIfStale: vi.fn(async () => false) }));

const tx = {
  usageEvent: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn() },
  interview: { count: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    usageEvent: { count: vi.fn(), updateMany: vi.fn(), create: vi.fn(), groupBy: vi.fn() },
    interview: { count: vi.fn() },
  },
}));

/** What the one credit query answers: units summed per kind (a consumption is one unit). */
const ledger = (granted: number, used = 0, revoked = 0) =>
  [
    { kind: "INTERVIEW_CREDIT_GRANT", _sum: { units: granted } },
    { kind: "INTERVIEW_CREDIT", _sum: { units: used } },
    { kind: "INTERVIEW_CREDIT_REVOKE", _sum: { units: revoked } },
  ] as never;

const NOW = new Date("2026-10-16T12:00:00Z");
const MONTH = { gte: new Date("2026-10-01T00:00:00Z"), lt: new Date("2026-11-01T00:00:00Z") };
/** A subscription whose billing period is Oct 5 to Nov 5. */
const SUBSCRIPTION: SubscriptionStanding = {
  id: "row_1",
  providerSubscriptionId: "sub_01",
  status: "ACTIVE",
  priceKey: "pro_monthly",
  currentPeriodStart: new Date("2026-10-05T00:00:00Z"),
  currentPeriodEnd: new Date("2026-11-05T00:00:00Z"),
  cancelAtPeriodEnd: false,
  scheduledChangeAt: null,
  canceledAt: null,
  providerUpdatedAt: NOW,
};
const BILLING_PERIOD = { gte: SUBSCRIPTION.currentPeriodStart, lt: SUBSCRIPTION.currentPeriodEnd };

const free = (everSubscribed = false): PlanStanding => ({ plan: "FREE", source: "free", subscription: null, everSubscribed });
const comped: PlanStanding = { plan: "PRO", source: "comp", subscription: null, everSubscribed: false };
const subscribed = (subscription = SUBSCRIPTION): PlanStanding => ({ plan: "PRO", source: "subscription", subscription, everSubscribed: true });

/** Both reads of the plan (inside and outside a transaction) answer the same. */
function setStanding(standing: PlanStanding) {
  vi.mocked(resolvePlanStanding).mockResolvedValue(standing);
  vi.mocked(resolvePlanStandingIn).mockResolvedValue(standing);
}

type Facts = { analyses?: number; periodUsed?: number; trials?: number; fullEver?: number; credits?: number; creditsUsed?: number; pending?: number };

/**
 * The entitlement's facts, as the one wave of three reads answers them:
 * the period's analyses and interviews grouped by kind; the lifetime
 * ledger grouped by kind (grants and revokes by units, trials, period
 * interviews and credit consumptions by count); the credits held by open
 * interviews. `fullEver` is the lifetime count of period interviews; a
 * consumed credit counts as voice on its own.
 */
function factsIn(db: typeof tx, { analyses = 0, periodUsed = 0, trials = 0, fullEver = 0, credits = 0, creditsUsed = 0, pending = 0 }: Facts) {
  db.usageEvent.groupBy
    .mockResolvedValueOnce([
      { kind: "ANALYSIS", _count: { _all: analyses } },
      { kind: "INTERVIEW", _count: { _all: periodUsed } },
    ] as never)
    .mockResolvedValueOnce([
      { kind: "INTERVIEW_CREDIT_GRANT", _count: { _all: credits > 0 ? 1 : 0 }, _sum: { units: credits } },
      { kind: "INTERVIEW_CREDIT", _count: { _all: creditsUsed }, _sum: { units: creditsUsed } },
      { kind: "INTERVIEW_TRIAL", _count: { _all: trials }, _sum: { units: trials } },
      { kind: "INTERVIEW", _count: { _all: fullEver }, _sum: { units: fullEver } },
    ] as never);
  db.interview.count.mockResolvedValueOnce(pending);
}

const PERIOD_GROUP = (createdAt: { gte: Date | null; lt: Date | null }) => ({
  by: ["kind"],
  where: { userId: "user_1", refundedAt: null, kind: { in: ["ANALYSIS", "INTERVIEW"] }, createdAt },
  _count: { _all: true },
});
const LIFETIME_GROUP = {
  by: ["kind"],
  where: {
    userId: "user_1",
    OR: [{ kind: { in: ["INTERVIEW_CREDIT_GRANT", "INTERVIEW_CREDIT_REVOKE"] } }, { kind: { in: ["INTERVIEW_CREDIT", "INTERVIEW", "INTERVIEW_TRIAL"] }, refundedAt: null }],
  },
  _count: { _all: true },
  _sum: { units: true },
};

const pool = { usageEvent: prisma.usageEvent as unknown as typeof tx.usageEvent, interview: prisma.interview as unknown as typeof tx.interview };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  setStanding(free());
  vi.mocked(reconcileIfStale).mockResolvedValue(false);
  tx.usageEvent.count.mockResolvedValue(0);
  tx.usageEvent.create.mockResolvedValue({ id: "evt_1" });
  tx.usageEvent.findUnique.mockResolvedValue(null);
  tx.usageEvent.groupBy.mockResolvedValue([]);
  tx.interview.count.mockResolvedValue(0);
  vi.mocked(prisma.usageEvent.count).mockResolvedValue(0);
  vi.mocked(prisma.usageEvent.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.interview.count).mockResolvedValue(0);
  vi.mocked(transactionApplied).mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reserveUsage", () => {
  it("counts the period's non-refunded events of the kind and inserts, serializably, with the plan derived inside the transaction", async () => {
    tx.usageEvent.count.mockResolvedValue(2);

    expect(await reserveUsage("user_1", "ANALYSIS", "analysis_1", NOW)).toEqual({ eventId: "evt_1" });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(resolvePlanStandingIn).toHaveBeenCalledWith(tx, "user_1", NOW);
    expect(tx.usageEvent.count).toHaveBeenCalledWith({
      where: { userId: "user_1", kind: "ANALYSIS", refundedAt: null, createdAt: MONTH },
    });
    expect(tx.usageEvent.create).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "ANALYSIS", refId: "analysis_1", createdAt: NOW },
      select: { id: true },
    });
  });

  it("refuses the fourth Free analysis of the month with the reset date, inserting nothing", async () => {
    tx.usageEvent.count.mockResolvedValue(PLANS.FREE.analysesPerMonth);

    await expect(reserveUsage("user_1", "ANALYSIS", "analysis_4", NOW)).rejects.toMatchObject({
      code: "ANALYSIS_QUOTA_EXCEEDED",
      meta: { plan: "FREE", resetsAt: "2026-11-01T00:00:00.000Z" },
    });
    expect(tx.usageEvent.create).not.toHaveBeenCalled();
  });

  it("refuses Pro's fair-use cap the same way, with the plan in the payload, and counts a subscribed Pro over its billing period", async () => {
    setStanding(subscribed());
    tx.usageEvent.count.mockResolvedValue(PLANS.PRO.analysesPerMonth);

    await expect(reserveUsage("user_1", "ANALYSIS", "a", NOW)).rejects.toMatchObject({
      code: "ANALYSIS_QUOTA_EXCEEDED",
      meta: { plan: "PRO", resetsAt: "2026-11-05T00:00:00.000Z" },
    });
    expect(tx.usageEvent.count).toHaveBeenCalledWith({
      where: { userId: "user_1", kind: "ANALYSIS", refundedAt: null, createdAt: BILLING_PERIOD },
    });
  });

  it("two reservations racing for the last unit: the loser retries and finds it taken", async () => {
    // First attempt fails to serialize; on the retry the count is at the limit.
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("raced", { code: "P2034", clientVersion: "test" }))
      .mockImplementationOnce(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
    tx.usageEvent.count.mockResolvedValue(PLANS.FREE.analysesPerMonth);

    await expect(reserveUsage("user_1", "ANALYSIS", "a", NOW)).rejects.toMatchObject({ code: "ANALYSIS_QUOTA_EXCEEDED" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.usageEvent.create).not.toHaveBeenCalled();
  });

  it("never reserves a credit, a grant or a revoke through the plain path", async () => {
    for (const kind of ["INTERVIEW_CREDIT", "INTERVIEW_CREDIT_GRANT", "INTERVIEW_CREDIT_REVOKE"] as const) {
      await expect(reserveUsage("user_1", kind, "x", NOW)).rejects.toMatchObject({ code: "UNKNOWN" });
    }
    expect(tx.usageEvent.create).not.toHaveBeenCalled();
  });
});

describe("reserveInterview: the entitlement decided inside the transaction", () => {
  it("reads the facts in one wave on the transaction and takes the unit the entitlement names: a Free account's trial, on the short agent", async () => {
    factsIn(tx, {});

    expect(await reserveInterview("user_1", "int_1", NOW)).toEqual({ eventId: "evt_1", kind: "INTERVIEW_TRIAL", tier: "TRIAL", seconds: 300, source: "trial" });

    expect(resolvePlanStandingIn).toHaveBeenCalledWith(tx, "user_1", NOW);
    expect(tx.usageEvent.groupBy).toHaveBeenNthCalledWith(1, PERIOD_GROUP(MONTH));
    expect(tx.usageEvent.groupBy).toHaveBeenNthCalledWith(2, LIFETIME_GROUP);
    expect(tx.usageEvent.count).not.toHaveBeenCalled();
    expect(tx.interview.count).toHaveBeenCalledWith({ where: { userId: "user_1", status: "IN_PROGRESS", paidBy: "CREDIT", usageEventId: { not: null } } });
    expect(tx.usageEvent.create).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "INTERVIEW_TRIAL", refId: "int_1", createdAt: NOW },
      select: { id: true },
    });
  });

  it("refuses a second trial, with no reset date, and gives no trial to an account that had voice", async () => {
    factsIn(tx, { trials: 1 });
    const error = await reserveInterview("user_1", "int_2", NOW).catch((e) => e);
    expect(error).toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });
    expect(error.meta.resetsAt).toBeUndefined();

    setStanding(free(true)); // subscribed once
    factsIn(tx, {});
    await expect(reserveInterview("user_1", "int_3", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });

    setStanding(free(false));
    factsIn(tx, { fullEver: 1 }); // a full interview while comped
    await expect(reserveInterview("user_1", "int_4", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED" });
    expect(tx.usageEvent.create).not.toHaveBeenCalled();
  });

  it("spends a pack credit on the full agent for a Free account before any trial: paid credits are usable on any plan", async () => {
    setStanding(free(true)); // Pro ended, credits kept
    factsIn(tx, { credits: 4 });
    expect(await reserveInterview("user_1", "int_1", NOW)).toEqual({ eventId: "evt_1", kind: "INTERVIEW_CREDIT", tier: "FULL", seconds: 720, source: "credit" });
    expect(tx.usageEvent.create).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "INTERVIEW_CREDIT", refId: "int_1", createdAt: NOW },
      select: { id: true },
    });

    // A never-subscribed Free account with a credit spends it too; once spent, that was voice, so no trial follows.
    setStanding(free(false));
    factsIn(tx, { credits: 1 });
    expect((await reserveInterview("user_1", "int_2", NOW)).source).toBe("credit");
    factsIn(tx, { credits: 1, creditsUsed: 1 });
    await expect(reserveInterview("user_1", "int_3", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });
    // A credit refunded (a silent session) was never voice: the trial is still there.
    factsIn(tx, { credits: 1, creditsUsed: 0 });
    expect((await reserveInterview("user_1", "int_4", NOW)).source).toBe("credit");
  });

  it("a grant made at the old pack size still counts for what it gave: the balance sums the units stored on each grant", async () => {
    setStanding(free(true));
    factsIn(tx, { credits: 5 + 4, creditsUsed: 8 }); // an old pack of 5, a new one of 4, eight used
    expect((await reserveInterview("user_1", "int_9", NOW)).kind).toBe("INTERVIEW_CREDIT");
    factsIn(tx, { credits: 5 + 4, creditsUsed: 9 });
    await expect(reserveInterview("user_1", "int_10", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });
  });

  it("a Pro takes one of the period's interviews on the full agent; a comped Pro's period is the month", async () => {
    setStanding(comped);
    factsIn(tx, { periodUsed: 2 });
    expect(await reserveInterview("user_1", "int_1", NOW)).toEqual({ eventId: "evt_1", kind: "INTERVIEW", tier: "FULL", seconds: 720, source: "period" });
    expect(tx.usageEvent.groupBy).toHaveBeenNthCalledWith(1, PERIOD_GROUP(MONTH));
  });

  it("counts a subscribed Pro's interviews over the billing period, and rolls over with it", async () => {
    setStanding(subscribed());
    factsIn(tx, { periodUsed: 3 });
    await reserveInterview("user_1", "int_1", NOW);
    expect(tx.usageEvent.groupBy).toHaveBeenNthCalledWith(1, PERIOD_GROUP(BILLING_PERIOD));

    // The renewal moved the period: the four used last period no longer count.
    const renewed = { ...SUBSCRIPTION, currentPeriodStart: new Date("2026-11-05T00:00:00Z"), currentPeriodEnd: new Date("2026-12-05T00:00:00Z") };
    setStanding(subscribed(renewed));
    const later = new Date("2026-11-10T00:00:00Z");
    factsIn(tx, { periodUsed: 0 });
    expect((await reserveInterview("user_1", "int_2", later)).kind).toBe("INTERVIEW");
    expect(tx.usageEvent.groupBy).toHaveBeenNthCalledWith(3, PERIOD_GROUP({ gte: renewed.currentPeriodStart, lt: renewed.currentPeriodEnd }));
  });

  it("a Pro spends a pack credit once the period's interviews are used, and is refused with the period's end when both are gone", async () => {
    setStanding(subscribed());
    factsIn(tx, { periodUsed: PLANS.PRO.interviewsPerMonth, credits: 5, creditsUsed: 1 });
    expect(await reserveInterview("user_1", "int_5", NOW)).toEqual({ eventId: "evt_1", kind: "INTERVIEW_CREDIT", tier: "FULL", seconds: 720, source: "credit" });

    factsIn(tx, { periodUsed: PLANS.PRO.interviewsPerMonth, credits: 5, creditsUsed: 5 });
    await expect(reserveInterview("user_1", "int_6", NOW)).rejects.toMatchObject({
      code: "INTERVIEW_QUOTA_EXCEEDED",
      meta: { plan: "PRO", resetsAt: "2026-11-05T00:00:00.000Z" },
    });
  });
});

describe("resolveInterviewEntitlement for a page", () => {
  it("is the same decision on the same facts, read on the pool", async () => {
    setStanding(free(true));
    factsIn(pool, { credits: 2, pending: 1 });
    expect(await resolveInterviewEntitlement("user_1", NOW)).toMatchObject({
      source: "credit",
      agent: "main",
      maxDurationSeconds: 720,
      remaining: { credits: 2, creditsPending: 1, trial: 0 },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("the credits (the grant and the balance live in credits.ts, tested there)", () => {
  it("a refund revokes only the unused part of the pack, keyed by the adjustment, serializably", async () => {
    // Grant of 5, two used: three come back.
    tx.usageEvent.findUnique
      .mockResolvedValueOnce(null) // no revoke for this adjustment yet
      .mockResolvedValueOnce({ units: 5, userId: "user_1" }); // the grant
    tx.usageEvent.groupBy.mockResolvedValueOnce(ledger(5, 2));

    expect(await revokeUnusedInterviewCredits("user_1", { transactionId: "txn_1", adjustmentId: "adj_1", now: NOW })).toEqual({
      revoked: 3,
      outcome: "revoked",
    });
    expect(tx.usageEvent.create).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "INTERVIEW_CREDIT_REVOKE", refId: "adj_1", units: 3, createdAt: NOW },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("a repeated refund event revokes nothing more, and a refund of someone else's grant nothing at all", async () => {
    tx.usageEvent.findUnique.mockResolvedValueOnce({ units: 3 });
    expect(await revokeUnusedInterviewCredits("user_1", { transactionId: "txn_1", adjustmentId: "adj_1", now: NOW })).toEqual({
      revoked: 3,
      outcome: "already",
    });

    tx.usageEvent.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ units: 5, userId: "user_2" });
    expect(await revokeUnusedInterviewCredits("user_1", { transactionId: "txn_1", adjustmentId: "adj_2", now: NOW })).toEqual({
      revoked: 0,
      outcome: "no-grant",
    });
    expect(tx.usageEvent.create).not.toHaveBeenCalled();
  });

  it("a refunded credit consumption is a credit again: the silent session's refund is the ordinary one", async () => {
    vi.mocked(prisma.usageEvent.updateMany).mockResolvedValueOnce({ count: 1 });
    expect(await refundUsage("evt_credit", "NO_CANDIDATE_TURNS")).toBe(true);
    expect(prisma.usageEvent.updateMany).toHaveBeenCalledWith({
      where: { id: "evt_credit", refundedAt: null },
      data: { refundedAt: expect.any(Date), refundReason: "NO_CANDIDATE_TURNS" },
    });
  });
});

describe("refundUsage", () => {
  it("dates the refund once; a second refund changes nothing", async () => {
    vi.mocked(prisma.usageEvent.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    expect(await refundUsage("evt_1", "AI_UNAVAILABLE")).toBe(true);
    expect(await refundUsage("evt_1", "AI_UNAVAILABLE")).toBe(false);
  });
});

describe("usageSummary and its views", () => {
  /** The summary's reads are the entitlement's facts: the analyses ride in the period group. */
  const summaryFacts = (facts: Facts) => factsIn(pool, facts);

  it("reports what is left per quota, the credits, the trial, the entitlement and the period, after sweeping abandoned interviews", async () => {
    summaryFacts({ analyses: 2 });

    const summary = await usageSummary("user_1", NOW);

    expect(expireAbandonedInterviews).toHaveBeenCalledWith("user_1", NOW);
    expect(vi.mocked(expireAbandonedInterviews).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.usageEvent.groupBy).mock.invocationCallOrder[0],
    );
    // Two waves: the sweep and the standing together, then the three facts reads and the customer together.
    expect(prisma.usageEvent.count).not.toHaveBeenCalled();

    expect(summary).toMatchObject({
      plan: "FREE",
      source: "free",
      analyses: { used: 2, limit: 3, left: 1, announce: true },
      interviews: { used: 0, limit: 0, left: 0 },
      credits: { balance: 0, pending: 0 },
      trial: { available: true, used: false },
      entitlement: { source: "trial", agent: "trial", maxDurationSeconds: 300 },
      period: { start: MONTH.gte, end: MONTH.lt },
      resetsAt: MONTH.lt,
      subscription: null,
      everSubscribed: false,
      hasBillingAccount: false,
    });
    expect(analysisQuotaView(summary)).toEqual({ plan: "FREE", left: 1, limit: 3, announce: true, resetsAt: "2026-11-01T00:00:00.000Z" });
    expect(interviewQuotaView(summary)).toMatchObject({ plan: "FREE", trialAvailable: true, left: 0, limit: 0, credits: 0, entitlement: { source: "trial" }, resetsAt: "2026-11-01T00:00:00.000Z" });
  });

  it("a subscribed Pro's counters run over the billing period, with the credits, and nothing announces analyses", async () => {
    setStanding(subscribed());
    vi.mocked(findBillingCustomer).mockResolvedValueOnce({ providerCustomerId: "ctm_01" });
    summaryFacts({ analyses: 10, periodUsed: 1, fullEver: 1, credits: 5, creditsUsed: 1 });

    const summary = await usageSummary("user_1", NOW);

    expect(summary.analyses).toEqual({ used: 10, limit: 50, left: 40, announce: false });
    expect(summary.interviews).toEqual({ used: 1, limit: 4, left: 3 });
    expect(summary.credits).toEqual({ balance: 4, pending: 0 });
    expect(summary.trial).toEqual({ available: false, used: false });
    expect(summary.entitlement).toMatchObject({ source: "period", remaining: { period: 3, credits: 4 }, resetsAt: "2026-11-05T00:00:00.000Z" });
    expect(summary.period).toEqual({ start: SUBSCRIPTION.currentPeriodStart, end: SUBSCRIPTION.currentPeriodEnd });
    expect(summary.resetsAt).toEqual(SUBSCRIPTION.currentPeriodEnd);
    expect(summary.subscription).toBe(SUBSCRIPTION);
    expect(summary.hasBillingAccount).toBe(true);
    expect(prisma.usageEvent.groupBy).toHaveBeenNthCalledWith(1, PERIOD_GROUP(BILLING_PERIOD));
    expect(prisma.usageEvent.groupBy).toHaveBeenNthCalledWith(2, LIFETIME_GROUP);
    expect(interviewQuotaView(summary)).toMatchObject({ plan: "PRO", left: 3, limit: 4, credits: 4, resetsAt: "2026-11-05T00:00:00.000Z" });
    expect(interviewQuotaView(summary)).not.toHaveProperty("creditsUsable");
    expect(requireUserId).not.toHaveBeenCalled();
  });

  it("after Pro ends the account is Free with no new trial, its credits kept and usable, and one pending while an interview holds it", async () => {
    setStanding(free(true));
    summaryFacts({ fullEver: 2, credits: 5, creditsUsed: 1, pending: 1 });

    const summary = await usageSummary("user_1", NOW);

    expect(summary.plan).toBe("FREE");
    expect(summary.trial).toEqual({ available: false, used: false });
    expect(summary.credits).toEqual({ balance: 4, pending: 1 });
    expect(summary.entitlement).toMatchObject({ source: "credit", agent: "main", maxDurationSeconds: 720, remaining: { credits: 4, creditsPending: 1 } });
    expect(summary.everSubscribed).toBe(true);
  });

  it("runs the lazy reconcile on the standing and re-reads the plan when it changed something", async () => {
    setStanding(subscribed());
    vi.mocked(reconcileIfStale).mockResolvedValueOnce(true);
    summaryFacts({});

    await usageSummary("user_1", NOW);

    expect(reconcileIfStale).toHaveBeenCalledWith("user_1", subscribed(), NOW);
    expect(resolvePlanStanding).toHaveBeenCalledTimes(2);
  });
});

describe("billingStatus", () => {
  it("reads the plan, the credits and the transaction's state in one wave, without the sweep or the reconcile", async () => {
    setStanding(subscribed());
    vi.mocked(prisma.usageEvent.groupBy).mockResolvedValueOnce(ledger(5, 1));
    vi.mocked(transactionApplied).mockResolvedValueOnce(true);

    const status = await billingStatus("user_1", { transactionId: "txn_01", item: "interview_pack" }, NOW);

    expect(status).toEqual({ plan: "PRO", subscription: SUBSCRIPTION, periodEnd: SUBSCRIPTION.currentPeriodEnd, credits: 4, transactionApplied: true });
    expect(transactionApplied).toHaveBeenCalledWith("user_1", "txn_01");
    expect(expireAbandonedInterviews).not.toHaveBeenCalled();
    expect(reconcileIfStale).not.toHaveBeenCalled();
    expect(prisma.usageEvent.count).not.toHaveBeenCalled();
    expect(findBillingCustomer).not.toHaveBeenCalled();
    expect(requireUserId).not.toHaveBeenCalled();
  });

  it("answers null for the transaction when none was named, and the month's end for a Free account", async () => {
    const status = await billingStatus("user_1", { transactionId: null, item: null }, NOW);
    expect(status).toEqual({ plan: "FREE", subscription: null, periodEnd: MONTH.lt, credits: 0, transactionApplied: null });
    expect(transactionApplied).not.toHaveBeenCalled();
  });

  it("counts a Pro checkout as applied once Pro is in force by subscription, even when no event named the transaction", async () => {
    // Only subscription.activated arrived: the row exists, its transactionId is null.
    setStanding(subscribed());
    vi.mocked(transactionApplied).mockResolvedValue(false);
    expect((await billingStatus("user_1", { transactionId: "txn_01", item: "pro_monthly" }, NOW)).transactionApplied).toBe(true);

    // A pack is never inferred from the plan, and a comped Pro is not a subscription.
    expect((await billingStatus("user_1", { transactionId: "txn_01", item: "interview_pack" }, NOW)).transactionApplied).toBe(false);
    setStanding(comped);
    expect((await billingStatus("user_1", { transactionId: "txn_01", item: "pro_monthly" }, NOW)).transactionApplied).toBe(false);
  });
});
