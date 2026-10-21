import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { INTERVIEW_ABANDON_MS, MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { ABANDONED, expireAbandonedInterviews } from "./interviewExpiry";
import { refundUsage } from "./usage";

vi.mock("@/lib/prisma", () => ({
  default: { interview: { findMany: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("./usage", () => ({ refundUsage: vi.fn(async () => true) }));

const NOW = new Date("2026-10-20T12:00:00Z");
const CUTOFF = new Date(NOW.getTime() - INTERVIEW_ABANDON_MS);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.interview.findMany).mockResolvedValue([]);
  vi.mocked(prisma.interview.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(refundUsage).mockResolvedValue(true);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("expireAbandonedInterviews", () => {
  it("looks for the caller's IN_PROGRESS interviews with starts left and no session in two hours", async () => {
    expect(await expireAbandonedInterviews("user_1", NOW)).toBe(0);

    expect(prisma.interview.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        status: "IN_PROGRESS",
        startCount: { lt: MAX_INTERVIEW_STARTS },
        lastSessionAt: { lt: CUTOFF },
      },
      select: { id: true, usageEventId: true },
    });
    expect(prisma.interview.updateMany).not.toHaveBeenCalled();
    expect(INTERVIEW_ABANDON_MS).toBe(2 * 60 * 60_000);
  });

  it("expires each one with a guarded update and refunds its reservation as ABANDONED", async () => {
    vi.mocked(prisma.interview.findMany).mockResolvedValue([
      { id: "int_1", usageEventId: "evt_1" },
      { id: "int_2", usageEventId: "evt_2" },
    ] as never);

    expect(await expireAbandonedInterviews("user_1", NOW)).toBe(2);

    expect(prisma.interview.updateMany).toHaveBeenCalledWith({
      where: { id: "int_1", userId: "user_1", status: "IN_PROGRESS", lastSessionAt: { lt: CUTOFF } },
      data: { status: "EXPIRED", failureReason: ABANDONED },
    });
    expect(refundUsage).toHaveBeenCalledWith("evt_1", ABANDONED);
    expect(refundUsage).toHaveBeenCalledWith("evt_2", ABANDONED);
  });

  it("refunds nothing when the user came back in between: the guarded update matched no row", async () => {
    vi.mocked(prisma.interview.findMany).mockResolvedValue([{ id: "int_1", usageEventId: "evt_1" }] as never);
    vi.mocked(prisma.interview.updateMany).mockResolvedValue({ count: 0 });

    expect(await expireAbandonedInterviews("user_1", NOW)).toBe(0);
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("expires a row that has no reservation to give back (from before the ledger)", async () => {
    vi.mocked(prisma.interview.findMany).mockResolvedValue([{ id: "int_old", usageEventId: null }] as never);

    expect(await expireAbandonedInterviews("user_1", NOW)).toBe(1);
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("names the user in the failure it logs", async () => {
    vi.mocked(prisma.interview.findMany).mockRejectedValue(new Error("db down"));

    await expect(expireAbandonedInterviews("user_9", NOW)).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("user=user_9"), expect.anything());
  });
});
