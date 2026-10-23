import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { createInterview, markInterviewEnded, reserveInterviewSession } from "./interview";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("./interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn(async () => 0) }));

/** A transaction client whose calls the tests script. */
const tx = {
  interview: { findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  default: { $transaction: vi.fn(), interview: { updateMany: vi.fn() } },
}));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const INTERVIEW_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const data = { role: "Backend Engineer", techstack: ["Go"], resumeId: RESUME_ID };

const raceError = (code: "P2034" | "P2002") =>
  new Prisma.PrismaClientKnownRequestError("raced", { code, clientVersion: "test" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  tx.interview.findFirst.mockResolvedValue(null);
  tx.interview.aggregate.mockResolvedValue({ _max: { attemptNumber: 2 } });
  tx.interview.create.mockImplementation(async ({ data: input }: { data: { attemptNumber: number } }) => ({
    id: "interview_new",
    attemptNumber: input.attemptNumber,
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createInterview", () => {
  it("numbers the next attempt after the highest one, inside a serializable transaction", async () => {
    const result = await createInterview(data);

    expect(result).toEqual({ id: "interview_new", attemptNumber: 3, created: true });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.interview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { role: "Backend Engineer", techstack: ["Go"], userId: "user_1", resumeAnalysisId: RESUME_ID, attemptNumber: 3 },
      }),
    );
  });

  it("starts at 1 for an analysis with no attempts, and puts no cap on how many there are", async () => {
    tx.interview.aggregate.mockResolvedValue({ _max: { attemptNumber: null } });
    expect((await createInterview(data)).attemptNumber).toBe(1);

    tx.interview.aggregate.mockResolvedValue({ _max: { attemptNumber: 9 } });
    expect((await createInterview(data)).attemptNumber).toBe(10);
  });

  it("returns the live attempt instead of creating, checking it inside the transaction", async () => {
    tx.interview.findFirst.mockResolvedValue({ id: "interview_live", attemptNumber: 2 });

    const result = await createInterview(data);

    expect(result).toEqual({ id: "interview_live", attemptNumber: 2, created: false });
    expect(tx.interview.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ resumeAnalysisId: RESUME_ID, userId: "user_1", status: { in: ["SCHEDULED", "IN_PROGRESS"] } }),
      }),
    );
    expect(tx.interview.create).not.toHaveBeenCalled();
  });

  it.each(["P2034", "P2002"] as const)("on a %s race, tries again and finds the winner live", async (code) => {
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce(raceError(code))
      .mockImplementationOnce(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
    tx.interview.findFirst.mockResolvedValue({ id: "interview_winner", attemptNumber: 3 });

    const result = await createInterview(data);

    expect(result).toEqual({ id: "interview_winner", attemptNumber: 3, created: false });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.interview.create).not.toHaveBeenCalled();
  });

  it("gives up after three races and reports the failure as unknown", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(raceError("P2034"));

    await expect(createInterview(data)).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it("does not retry an unrelated failure", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("connection reset"));

    await expect(createInterview(data)).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("reserveInterviewSession", () => {
  const base = {
    interviewId: INTERVIEW_ID,
    issuedContext: { interview_id: INTERVIEW_ID },
    conversationId: "conv_2",
    startedAt: new Date("2026-10-16T12:00:00Z"),
    issuedAt: new Date("2026-10-16T12:05:00Z"),
    maxStarts: 3,
  };

  it("clears every leftover of the previous session, the reconcile throttle included, and dates this session", async () => {
    vi.mocked(prisma.interview.updateMany).mockResolvedValue({ count: 1 });

    expect(await reserveInterviewSession(base)).toBe(true);

    expect(prisma.interview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: INTERVIEW_ID, userId: "user_1", startCount: { lt: 3 } }),
        data: expect.objectContaining({
          status: "IN_PROGRESS",
          conversationId: "conv_2",
          // The first session's time stays; the latest one is what the abandoned sweep reads.
          startedAt: new Date("2026-10-16T12:00:00Z"),
          lastSessionAt: new Date("2026-10-16T12:05:00Z"),
          endedAt: null,
          durationSeconds: null,
          failureReason: null,
          transcriptSource: null,
          reconcileCheckedAt: null,
        }),
      }),
    );
    // A reconnect touches neither the unit nor the tier.
    const { data, where } = vi.mocked(prisma.interview.updateMany).mock.calls[0][0] as { data: Record<string, unknown>; where: Record<string, unknown> };
    expect(data).not.toHaveProperty("usageEventId");
    expect(data).not.toHaveProperty("tier");
    expect(where).not.toHaveProperty("usageEventId");
  });

  it("on the first token, sets the unit and the tier only on a row that has none", async () => {
    vi.mocked(prisma.interview.updateMany).mockResolvedValue({ count: 1 });

    await reserveInterviewSession({ ...base, reservation: { usageEventId: "evt_1", tier: "TRIAL", paidBy: "TRIAL" } });

    expect(prisma.interview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ usageEventId: null }),
        data: expect.objectContaining({ usageEventId: "evt_1", tier: "TRIAL", paidBy: "TRIAL" }),
      }),
    );
  });
});

describe("markInterviewEnded", () => {
  const endedAt = new Date("2026-10-13T12:00:00Z");

  it("writes the end time once, owner-scoped, only while in progress with none set", async () => {
    vi.mocked(prisma.interview.updateMany).mockResolvedValue({ count: 1 });

    expect(await markInterviewEnded({ interviewId: INTERVIEW_ID, endedAt })).toBe(true);
    expect(prisma.interview.updateMany).toHaveBeenCalledWith({
      where: { id: INTERVIEW_ID, userId: "user_1", status: "IN_PROGRESS", endedAt: null },
      data: { endedAt },
    });
  });

  it("reports false when nothing matched: a second report, a stored transcript, or a foreign id", async () => {
    vi.mocked(prisma.interview.updateMany).mockResolvedValue({ count: 0 });

    expect(await markInterviewEnded({ interviewId: INTERVIEW_ID, endedAt })).toBe(false);
  });
});
