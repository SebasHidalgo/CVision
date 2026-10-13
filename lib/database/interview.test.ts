import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { createInterview, markInterviewEnded } from "./interview";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));

/** A transaction client whose calls the tests script. */
const tx = {
  interview: { findFirst: vi.fn(), count: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  default: { $transaction: vi.fn(), interview: { updateMany: vi.fn() } },
}));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const INTERVIEW_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const data = { role: "Backend Engineer", techstack: ["Go"], resumeId: RESUME_ID, maxAttempts: 3 };

const raceError = (code: "P2034" | "P2002") =>
  new Prisma.PrismaClientKnownRequestError("raced", { code, clientVersion: "test" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  tx.interview.findFirst.mockResolvedValue(null);
  tx.interview.count.mockResolvedValue(2);
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

  it("starts at 1 for an analysis with no attempts", async () => {
    tx.interview.count.mockResolvedValue(0);
    tx.interview.aggregate.mockResolvedValue({ _max: { attemptNumber: null } });
    expect((await createInterview(data)).attemptNumber).toBe(1);
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

  it("refuses at the cap inside the transaction, counting every state but FAILED and EXPIRED", async () => {
    tx.interview.count.mockResolvedValue(3);

    await expect(createInterview(data)).rejects.toMatchObject({ code: "INTERVIEW_ATTEMPT_LIMIT" });
    expect(tx.interview.count).toHaveBeenCalledWith({
      where: { resumeAnalysisId: RESUME_ID, status: { notIn: ["FAILED", "EXPIRED"] } },
    });
    expect(tx.interview.create).not.toHaveBeenCalled();
    // Not a race: no retry.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
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
