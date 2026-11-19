import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { emptyGuardReport } from "@/lib/ai/analysisGuardrails";
import { toGuardStats } from "@/lib/ai/schemas";
import { recordGuardStatsDaily } from "./guardStats";
import { createResume, type CreateResumeData } from "./resume";

/**
 * The charge and the row are one transaction: the unit is settled on the same client that inserts the analysis, so
 * no request can die between them, and a unit given back meanwhile saves nothing.
 */

const tx = vi.hoisted(() => ({
  usageEvent: { updateMany: vi.fn() },
  resumeAnalysis: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    usageEvent: { updateMany: vi.fn() },
    resumeAnalysis: { create: vi.fn() },
  },
}));
vi.mock("./guardStats", () => ({ recordGuardStatsDaily: vi.fn(async () => {}) }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1"), getOptionalUserIdOutsideProxy: vi.fn() }));
vi.mock("./interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn() }));
vi.mock("./billing", () => ({ resolvePlanStanding: vi.fn(), resolvePlanStandingIn: vi.fn(), findBillingCustomer: vi.fn(), transactionApplied: vi.fn(), listSubscriptionRows: vi.fn() }));
vi.mock("@/lib/billing/reconcile", () => ({ reconcileIfStale: vi.fn() }));

const NOW = new Date("2026-11-19T12:00:00Z");
const ANALYSIS_ID = "0b7e2d14-3f9a-8c61-8e05-7d2c9a4b1f63";

const data = (): CreateResumeData => ({
  id: ANALYSIS_ID,
  companyName: "Northwind",
  jobTitle: "Frontend Engineer",
  jobDescription: "Build the checkout in React.",
  resumeKey: "cv/user_1/11111111-2222-4333-8444-555555555555.pdf",
  feedback: { overall: {}, atsCompatibility: {}, experienceAndImpact: {}, educationAndCertifications: {}, skills: {}, toneAndClarity: {}, jobFit: {} } as never,
  guardStats: toGuardStats(emptyGuardReport()),
  usageEventId: "evt_1",
});

beforeEach(() => {
  vi.clearAllMocks();
  tx.usageEvent.updateMany.mockResolvedValue({ count: 1 });
  tx.resumeAnalysis.create.mockResolvedValue({ id: ANALYSIS_ID });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createResume: the unit is spent with its row, in one transaction", () => {
  it("settles the user's held unit, then inserts the row and the day's tallies, all on the transaction's client", async () => {
    expect(await createResume(data(), NOW)).toEqual({ kind: "saved", id: ANALYSIS_ID });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.usageEvent.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "evt_1", userId: "user_1", kind: "ANALYSIS", refundedAt: null, settledAt: null },
      data: { settledAt: NOW },
    });
    expect(tx.resumeAnalysis.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: ANALYSIS_ID, userId: "user_1" }) }));
    expect(recordGuardStatsDaily).toHaveBeenCalledWith(tx, "ANALYSIS", NOW, expect.anything());
    // Nothing on the pool: there is no moment with the unit spent and the row missing.
    expect(prisma.usageEvent.updateMany).not.toHaveBeenCalled();
    expect(prisma.resumeAnalysis.create).not.toHaveBeenCalled();
    expect(tx.usageEvent.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.resumeAnalysis.create.mock.invocationCallOrder[0]);
  });

  it("saves nothing under a unit given back meanwhile (refunded or already settled)", async () => {
    tx.usageEvent.updateMany.mockResolvedValue({ count: 0 });

    expect(await createResume(data(), NOW)).toEqual({ kind: "unit-released" });
    expect(tx.resumeAnalysis.create).not.toHaveBeenCalled();
    expect(recordGuardStatsDaily).not.toHaveBeenCalled();
  });

  it("an insert that fails fails the whole transaction, the settle with it, and reaches the caller typed", async () => {
    tx.resumeAnalysis.create.mockRejectedValue(new Error("Unique constraint failed on the fields: (`id`)"));

    await expect(createResume(data(), NOW)).rejects.toMatchObject({ code: "UNKNOWN" });
    // The settle ran inside the same transaction callback that threw: Postgres rolls both back.
    expect(tx.usageEvent.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.usageEvent.updateMany).not.toHaveBeenCalled();
    expect(recordGuardStatsDaily).not.toHaveBeenCalled();
  });
});
