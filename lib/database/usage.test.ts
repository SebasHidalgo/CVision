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
  grantInterviewCredits,
  interviewCreditBalance,
  interviewQuotaView,
  refundUsage,
  reserveInterview,
  reserveUsage,
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
};
vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    usageEvent: { count: vi.fn(), updateMany: vi.fn(), create: vi.fn(), groupBy: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  setStanding(free());
  vi.mocked(reconcileIfStale).mockResolvedValue(false);
  tx.usageEvent.count.mockResolvedValue(0);
  tx.usageEvent.create.mockResolvedValue({ id: "evt_1" });
  tx.usageEvent.findUnique.mockResolvedValue(null);
  tx.usageEvent.groupBy.mockResolvedValue([]);
  vi.mocked(prisma.usageEvent.count).mockResolvedValue(0);
  vi.mocked(prisma.usageEvent.groupBy).mockResolvedValue([] as never);
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

describe("reserveInterview: the Free trial", () => {
  it("gives an account that never had voice its one trial on the short agent", async () => {
    expect(await reserveInterview("user_1", "int_1", NOW)).toEqual({ eventId: "evt_1", kind: "INTERVIEW_TRIAL", tier: "TRIAL", seconds: 300 });

    expect(tx.usageEvent.count).toHaveBeenCalledWith({ where: { userId: "user_1", kind: "INTERVIEW_TRIAL", refundedAt: null } });
    expect(tx.usageEvent.count).toHaveBeenCalledWith({
      where: { userId: "user_1", kind: { in: ["INTERVIEW", "INTERVIEW_CREDIT"] }, refundedAt: null },
    });
    expect(tx.usageEvent.create).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "INTERVIEW_TRIAL", refId: "int_1", createdAt: NOW },
      select: { id: true },
    });
  });

  it("refuses a second trial, with no reset date", async () => {
    tx.usageEvent.count.mockResolvedValueOnce(1);
    const error = await reserveInterview("user_1", "int_2", NOW).catch((e) => e);
    expect(error).toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });
    expect(error.meta.resetsAt).toBeUndefined();
    expect(tx.usageEvent.create).not.toHaveBeenCalled();
  });

  it("gives no trial to an account that had voice: one that subscribed once, or one that ran a full interview while comped", async () => {
    setStanding(free(true));
    await expect(reserveInterview("user_1", "int_1", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });

    setStanding(free(false));
    tx.usageEvent.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1); // no trial yet, one full interview ever
    await expect(reserveInterview("user_1", "int_1", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED" });
    expect(tx.usageEvent.create).not.toHaveBeenCalled();
  });

  it("spends a pack credit on the full agent for a Free account before any trial: paid credits are usable on any plan", async () => {
    // An account whose Pro ended, holding credits: the credit goes first, the trial is not even looked at.
    setStanding(free(true));
    tx.usageEvent.groupBy.mockResolvedValueOnce(ledger(4));

    expect(await reserveInterview("user_1", "int_1", NOW)).toEqual({ eventId: "evt_1", kind: "INTERVIEW_CREDIT", tier: "FULL", seconds: 720 });
    expect(tx.usageEvent.count).not.toHaveBeenCalled();
    expect(tx.usageEvent.create).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "INTERVIEW_CREDIT", refId: "int_1", createdAt: NOW },
      select: { id: true },
    });

    // A never-subscribed Free account with credits (a gift, a refunded consumption) spends them too, and keeps its trial for later.
    setStanding(free(false));
    tx.usageEvent.groupBy.mockResolvedValueOnce(ledger(1));
    expect((await reserveInterview("user_1", "int_2", NOW)).kind).toBe("INTERVIEW_CREDIT");
    expect(tx.usageEvent.count).not.toHaveBeenCalled();

    // With the credits gone, the trial is what is left, if the account never had voice.
    tx.usageEvent.groupBy.mockResolvedValueOnce(ledger(1, 1));
    tx.usageEvent.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    expect((await reserveInterview("user_1", "int_3", NOW)).kind).toBe("INTERVIEW_TRIAL");
  });

  it("a grant made at the old pack size still counts for what it gave: the balance sums the units stored on each grant", async () => {
    setStanding(free(true));
    tx.usageEvent.groupBy.mockResolvedValueOnce(ledger(5 + 4, 8)); // an old pack of 5, a new one of 4, eight used
    expect((await reserveInterview("user_1", "int_9", NOW)).kind).toBe("INTERVIEW_CREDIT");

    tx.usageEvent.groupBy.mockResolvedValueOnce(ledger(5 + 4, 9));
    tx.usageEvent.count.mockResolvedValueOnce(0); // never a trial; it had voice anyway (it subscribed once), so no second count
    await expect(reserveInterview("user_1", "int_10", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });
    expect(tx.usageEvent.count).toHaveBeenCalledTimes(1);
  });
});

describe("reserveInterview: Pro", () => {
  it("takes one of the period's interviews on the full agent; a comped Pro's period is the month", async () => {
    setStanding(comped);
    tx.usageEvent.count.mockResolvedValueOnce(2);

    expect(await reserveInterview("user_1", "int_1", NOW)).toEqual({ eventId: "evt_1", kind: "INTERVIEW", tier: "FULL", seconds: 720 });
    expect(tx.usageEvent.count).toHaveBeenCalledWith({
      where: { userId: "user_1", kind: "INTERVIEW", refundedAt: null, createdAt: MONTH },
    });
  });

  it("counts a subscribed Pro's interviews over the billing period, and rolls over with it", async () => {
    setStanding(subscribed());
    tx.usageEvent.count.mockResolvedValueOnce(3);
    await reserveInterview("user_1", "int_1", NOW);
    expect(tx.usageEvent.count).toHaveBeenCalledWith({
      where: { userId: "user_1", kind: "INTERVIEW", refundedAt: null, createdAt: BILLING_PERIOD },
    });

    // The renewal moved the period: the four used last period no longer count.
    const renewed = { ...SUBSCRIPTION, currentPeriodStart: new Date("2026-11-05T00:00:00Z"), currentPeriodEnd: new Date("2026-12-05T00:00:00Z") };
    setStanding(subscribed(renewed));
    const later = new Date("2026-11-10T00:00:00Z");
    tx.usageEvent.count.mockResolvedValueOnce(0);
    expect((await reserveInterview("user_1", "int_2", later)).kind).toBe("INTERVIEW");
    expect(tx.usageEvent.count).toHaveBeenLastCalledWith({
      where: { userId: "user_1", kind: "INTERVIEW", refundedAt: null, createdAt: { gte: renewed.currentPeriodStart, lt: renewed.currentPeriodEnd } },
    });
  });

  it("spends a pack credit once the period's interviews are used, on the full agent", async () => {
    setStanding(subscribed());
    tx.usageEvent.count.mockResolvedValueOnce(PLANS.PRO.interviewsPerMonth); // period used up
    tx.usageEvent.groupBy.mockResolvedValueOnce(ledger(5, 1)); // one credit spent before

    expect(await reserveInterview("user_1", "int_5", NOW)).toEqual({ eventId: "evt_1", kind: "INTERVIEW_CREDIT", tier: "FULL", seconds: 720 });
    expect(tx.usageEvent.groupBy).toHaveBeenCalledWith({
      by: ["kind"],
      where: {
        userId: "user_1",
        OR: [{ kind: { in: ["INTERVIEW_CREDIT_GRANT", "INTERVIEW_CREDIT_REVOKE"] } }, { kind: "INTERVIEW_CREDIT", refundedAt: null }],
      },
      _sum: { units: true },
    });
    expect(tx.usageEvent.create).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "INTERVIEW_CREDIT", refId: "int_5", createdAt: NOW },
      select: { id: true },
    });
  });

  it("refuses with the period's end when both the interviews and the credits are gone", async () => {
    setStanding(subscribed());
    tx.usageEvent.count.mockResolvedValueOnce(PLANS.PRO.interviewsPerMonth);
    tx.usageEvent.groupBy.mockResolvedValueOnce(ledger(5, 5));

    await expect(reserveInterview("user_1", "int_6", NOW)).rejects.toMatchObject({
      code: "INTERVIEW_QUOTA_EXCEEDED",
      meta: { plan: "PRO", resetsAt: "2026-11-05T00:00:00.000Z" },
    });
    expect(tx.usageEvent.create).not.toHaveBeenCalled();
  });
});

describe("the credits", () => {
  it("grants a pack once: the transaction id is the grant's key, and a replay grants nothing", async () => {
    vi.mocked(prisma.usageEvent.create).mockResolvedValueOnce({} as never);
    expect(await grantInterviewCredits("user_1", { units: 5, transactionId: "txn_1", now: NOW })).toEqual({ granted: true });
    expect(prisma.usageEvent.create).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "INTERVIEW_CREDIT_GRANT", refId: "txn_1", units: 5, createdAt: NOW },
    });

    vi.mocked(prisma.usageEvent.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }),
    );
    expect(await grantInterviewCredits("user_1", { units: 5, transactionId: "txn_1", now: NOW })).toEqual({ granted: false });
  });

  it("the balance is grants minus revokes minus non-refunded consumption, never below zero, read in one query", async () => {
    vi.mocked(prisma.usageEvent.groupBy).mockResolvedValueOnce(ledger(10, 4, 3));
    expect(await interviewCreditBalance("user_1")).toBe(3);
    expect(prisma.usageEvent.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.usageEvent.count).not.toHaveBeenCalled();

    vi.mocked(prisma.usageEvent.groupBy).mockResolvedValueOnce(ledger(5, 2, 5));
    expect(await interviewCreditBalance("user_1")).toBe(0);

    // A kind with no rows is simply absent from the answer.
    vi.mocked(prisma.usageEvent.groupBy).mockResolvedValueOnce([{ kind: "INTERVIEW_CREDIT_GRANT", _sum: { units: 4 } }] as never);
    expect(await interviewCreditBalance("user_1")).toBe(4);
  });

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
  /** The summary's counts, in order: analyses, interviews, trials, full interviews ever. The credits are the one groupBy. */
  const counts = (analyses: number, interviews: number, trials: number, fullEver: number) =>
    vi.mocked(prisma.usageEvent.count).mockResolvedValueOnce(analyses).mockResolvedValueOnce(interviews).mockResolvedValueOnce(trials).mockResolvedValueOnce(fullEver);

  it("reports what is left per quota, the credits, the trial's state and the period, after sweeping abandoned interviews", async () => {
    counts(2, 0, 0, 0);

    const summary = await usageSummary("user_1", NOW);

    expect(expireAbandonedInterviews).toHaveBeenCalledWith("user_1", NOW);
    expect(vi.mocked(expireAbandonedInterviews).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.usageEvent.count).mock.invocationCallOrder[0],
    );

    expect(summary).toEqual({
      plan: "FREE",
      source: "free",
      analyses: { used: 2, limit: 3, left: 1, announce: true },
      interviews: { used: 0, limit: 0, left: 0 },
      credits: { balance: 0 },
      trial: { available: true, used: false },
      period: { start: MONTH.gte, end: MONTH.lt },
      resetsAt: MONTH.lt,
      subscription: null,
      everSubscribed: false,
      hasBillingAccount: false,
    });
    expect(analysisQuotaView(summary)).toEqual({ plan: "FREE", left: 1, limit: 3, announce: true, resetsAt: "2026-11-01T00:00:00.000Z" });
    expect(interviewQuotaView(summary)).toEqual({
      plan: "FREE",
      trialAvailable: true,
      left: 0,
      limit: 0,
      credits: 0,
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
  });

  it("a subscribed Pro's counters run over the billing period, with the credits, and nothing announces analyses", async () => {
    setStanding(subscribed());
    vi.mocked(findBillingCustomer).mockResolvedValueOnce({ providerCustomerId: "ctm_01" });
    counts(10, 1, 0, 1);
    vi.mocked(prisma.usageEvent.groupBy).mockResolvedValueOnce(ledger(5, 1));

    const summary = await usageSummary("user_1", NOW);

    expect(summary.analyses).toEqual({ used: 10, limit: 50, left: 40, announce: false });
    expect(summary.interviews).toEqual({ used: 1, limit: 4, left: 3 });
    expect(summary.credits).toEqual({ balance: 4 });
    expect(summary.trial).toEqual({ available: false, used: false });
    expect(summary.period).toEqual({ start: SUBSCRIPTION.currentPeriodStart, end: SUBSCRIPTION.currentPeriodEnd });
    expect(summary.resetsAt).toEqual(SUBSCRIPTION.currentPeriodEnd);
    expect(summary.subscription).toBe(SUBSCRIPTION);
    expect(summary.hasBillingAccount).toBe(true);
    for (const call of vi.mocked(prisma.usageEvent.count).mock.calls.slice(0, 2)) {
      expect(call[0]).toMatchObject({ where: { refundedAt: null, createdAt: BILLING_PERIOD } });
    }
    expect(interviewQuotaView(summary)).toMatchObject({ plan: "PRO", left: 3, limit: 4, credits: 4, resetsAt: "2026-11-05T00:00:00.000Z" });
    expect(interviewQuotaView(summary)).not.toHaveProperty("creditsUsable");
    expect(requireUserId).not.toHaveBeenCalled();
  });

  it("after Pro ends the account is Free with no new trial and its credits kept, still usable", async () => {
    setStanding(free(true));
    counts(0, 0, 0, 2);
    vi.mocked(prisma.usageEvent.groupBy).mockResolvedValueOnce(ledger(5, 1));

    const summary = await usageSummary("user_1", NOW);

    expect(summary.plan).toBe("FREE");
    expect(summary.trial).toEqual({ available: false, used: false });
    expect(summary.credits).toEqual({ balance: 4 });
    expect(summary.everSubscribed).toBe(true);
  });

  it("runs the lazy reconcile on the standing and re-reads the plan when it changed something", async () => {
    setStanding(subscribed());
    vi.mocked(reconcileIfStale).mockResolvedValueOnce(true);
    counts(0, 0, 0, 0);

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

    const status = await billingStatus("user_1", "txn_01", NOW);

    expect(status).toEqual({ plan: "PRO", subscription: SUBSCRIPTION, periodEnd: SUBSCRIPTION.currentPeriodEnd, credits: 4, transactionApplied: true });
    expect(transactionApplied).toHaveBeenCalledWith("user_1", "txn_01");
    expect(expireAbandonedInterviews).not.toHaveBeenCalled();
    expect(reconcileIfStale).not.toHaveBeenCalled();
    expect(prisma.usageEvent.count).not.toHaveBeenCalled();
    expect(findBillingCustomer).not.toHaveBeenCalled();
    expect(requireUserId).not.toHaveBeenCalled();
  });

  it("answers null for the transaction when none was named, and the month's end for a Free account", async () => {
    const status = await billingStatus("user_1", null, NOW);
    expect(status).toEqual({ plan: "FREE", subscription: null, periodEnd: MONTH.lt, credits: 0, transactionApplied: null });
    expect(transactionApplied).not.toHaveBeenCalled();
  });
});
