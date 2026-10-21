import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { PLANS } from "@/lib/plans";
import { resolvePlanStanding, resolvePlanStandingIn } from "./billing";
import { expireAbandonedInterviews } from "./interviewExpiry";
import {
  analysisQuotaView,
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
vi.mock("./billing", () => ({ resolvePlanStanding: vi.fn(), resolvePlanStandingIn: vi.fn() }));

const tx = {
  usageEvent: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    usageEvent: { count: vi.fn(), updateMany: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
  },
}));

const NOW = new Date("2026-10-16T12:00:00Z");
const PERIOD = { gte: new Date("2026-10-01T00:00:00Z"), lt: new Date("2026-11-01T00:00:00Z") };

const standing = (plan: "FREE" | "PRO") => ({ plan, source: plan === "PRO" ? "comp" : "free", subscription: null, everSubscribed: false }) as never;
/** Both reads of the plan (inside and outside a transaction) answer the same. */
function setPlan(plan: "FREE" | "PRO") {
  vi.mocked(resolvePlanStanding).mockResolvedValue(standing(plan));
  vi.mocked(resolvePlanStandingIn).mockResolvedValue(standing(plan));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  setPlan("FREE");
  tx.usageEvent.count.mockResolvedValue(0);
  tx.usageEvent.create.mockResolvedValue({ id: "evt_1" });
  tx.usageEvent.findUnique.mockResolvedValue(null);
  tx.usageEvent.aggregate.mockResolvedValue({ _sum: { units: null } });
  vi.mocked(prisma.usageEvent.count).mockResolvedValue(0);
  vi.mocked(prisma.usageEvent.aggregate).mockResolvedValue({ _sum: { units: null } } as never);
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
      where: { userId: "user_1", kind: "ANALYSIS", refundedAt: null, createdAt: PERIOD },
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

  it("refuses Pro's fair-use cap the same way, with the plan in the payload", async () => {
    setPlan("PRO");
    tx.usageEvent.count.mockResolvedValue(PLANS.PRO.analysesPerMonth);

    await expect(reserveUsage("user_1", "ANALYSIS", "a", NOW)).rejects.toMatchObject({
      code: "ANALYSIS_QUOTA_EXCEEDED",
      meta: { plan: "PRO" },
    });
  });

  it("the trial is a lifetime unit: no period in the count, no reset date in the refusal", async () => {
    await reserveUsage("user_1", "INTERVIEW_TRIAL", "int_1", NOW);
    expect(tx.usageEvent.count).toHaveBeenCalledWith({
      where: { userId: "user_1", kind: "INTERVIEW_TRIAL", refundedAt: null },
    });

    tx.usageEvent.count.mockResolvedValue(1);
    await expect(reserveUsage("user_1", "INTERVIEW_TRIAL", "int_2", NOW)).rejects.toMatchObject({
      code: "INTERVIEW_QUOTA_EXCEEDED",
      meta: { plan: "FREE" },
    });
    const error = await reserveUsage("user_1", "INTERVIEW_TRIAL", "int_2", NOW).catch((e) => e);
    expect(error.meta.resetsAt).toBeUndefined();
  });

  it("a Free account has no full interview at all", async () => {
    await expect(reserveUsage("user_1", "INTERVIEW", "int_1", NOW)).rejects.toMatchObject({
      code: "INTERVIEW_QUOTA_EXCEEDED",
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

  it("never reserves a grant or a revoke: those are the webhook's writes", async () => {
    await expect(reserveUsage("user_1", "INTERVIEW_CREDIT_GRANT", "txn_1", NOW)).rejects.toMatchObject({ code: "UNKNOWN" });
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

  it("the balance is grants minus revokes minus non-refunded consumption, never below zero", async () => {
    vi.mocked(prisma.usageEvent.aggregate)
      .mockResolvedValueOnce({ _sum: { units: 10 } } as never) // granted
      .mockResolvedValueOnce({ _sum: { units: 3 } } as never); // revoked
    vi.mocked(prisma.usageEvent.count).mockResolvedValueOnce(4); // used
    expect(await interviewCreditBalance("user_1")).toBe(3);
    expect(vi.mocked(prisma.usageEvent.count).mock.calls[0][0]).toEqual({
      where: { userId: "user_1", kind: "INTERVIEW_CREDIT", refundedAt: null },
    });

    vi.mocked(prisma.usageEvent.aggregate)
      .mockResolvedValueOnce({ _sum: { units: 5 } } as never)
      .mockResolvedValueOnce({ _sum: { units: 5 } } as never);
    vi.mocked(prisma.usageEvent.count).mockResolvedValueOnce(2);
    expect(await interviewCreditBalance("user_1")).toBe(0);
  });

  it("a refund revokes only the unused part of the pack, keyed by the adjustment, serializably", async () => {
    // Grant of 5, two used: three come back.
    tx.usageEvent.findUnique
      .mockResolvedValueOnce(null) // no revoke for this adjustment yet
      .mockResolvedValueOnce({ units: 5, userId: "user_1" }); // the grant
    tx.usageEvent.aggregate.mockResolvedValueOnce({ _sum: { units: 5 } }).mockResolvedValueOnce({ _sum: { units: null } });
    tx.usageEvent.count.mockResolvedValueOnce(2);

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
});

describe("reserveInterview", () => {
  it("gives a Free account the trial on the short agent", async () => {
    expect(await reserveInterview("user_1", "int_1", NOW)).toEqual({
      eventId: "evt_1",
      kind: "INTERVIEW_TRIAL",
      tier: "TRIAL",
      seconds: 300,
    });
  });

  it("gives a Pro account a monthly interview on the full agent", async () => {
    setPlan("PRO");

    expect(await reserveInterview("user_1", "int_1", NOW)).toEqual({
      eventId: "evt_1",
      kind: "INTERVIEW",
      tier: "FULL",
      seconds: 720,
    });
  });
});

describe("refundUsage", () => {
  it("dates the refund once; a second refund changes nothing", async () => {
    vi.mocked(prisma.usageEvent.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    expect(await refundUsage("evt_1", "AI_UNAVAILABLE")).toBe(true);
    expect(prisma.usageEvent.updateMany).toHaveBeenCalledWith({
      where: { id: "evt_1", refundedAt: null },
      data: { refundedAt: expect.any(Date), refundReason: "AI_UNAVAILABLE" },
    });
    expect(await refundUsage("evt_1", "AI_UNAVAILABLE")).toBe(false);
  });
});

describe("usageSummary and its views", () => {
  it("reports what is left per quota, the trial's state and the reset date, after sweeping abandoned interviews", async () => {
    vi.mocked(prisma.usageEvent.count)
      .mockResolvedValueOnce(2) // analyses this month
      .mockResolvedValueOnce(0) // interviews this month
      .mockResolvedValueOnce(0); // trials ever

    const summary = await usageSummary("user_1", NOW);

    expect(expireAbandonedInterviews).toHaveBeenCalledWith("user_1", NOW);
    expect(vi.mocked(expireAbandonedInterviews).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.usageEvent.count).mock.invocationCallOrder[0],
    );

    expect(summary).toEqual({
      plan: "FREE",
      analyses: { used: 2, limit: 3, left: 1, announce: true },
      interviews: { used: 0, limit: 0, left: 0 },
      trial: { available: true, used: false },
      resetsAt: new Date("2026-11-01T00:00:00Z"),
    });
    expect(analysisQuotaView(summary)).toEqual({ plan: "FREE", left: 1, limit: 3, announce: true, resetsAt: "2026-11-01T00:00:00.000Z" });
    expect(interviewQuotaView(summary)).toEqual({ plan: "FREE", trialAvailable: true, left: 0, limit: 0, resetsAt: "2026-11-01T00:00:00.000Z" });
  });

  it("never counts refunded events, and a Pro summary does not announce analyses", async () => {
    setPlan("PRO");
    vi.mocked(prisma.usageEvent.count).mockResolvedValueOnce(10).mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const summary = await usageSummary("user_1", NOW);

    expect(summary.analyses).toEqual({ used: 10, limit: 50, left: 40, announce: false });
    expect(summary.interviews).toEqual({ used: 1, limit: 4, left: 3 });
    expect(summary.trial).toEqual({ available: false, used: false });
    for (const call of vi.mocked(prisma.usageEvent.count).mock.calls) {
      expect(call[0]).toMatchObject({ where: { refundedAt: null } });
    }
    expect(requireUserId).not.toHaveBeenCalled();
  });
});
