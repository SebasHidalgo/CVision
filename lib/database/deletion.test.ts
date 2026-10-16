import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { collectDetachedConversationIds, deleteAnalysisRows, listAnalysisIdsOfUser } from "./deletion";

const tx = {
  resumeAnalysis: { findFirst: vi.fn(), deleteMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    resumeAnalysis: { findMany: vi.fn() },
    interview: { findMany: vi.fn() },
  },
}));

const ANALYSIS_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const KEY = "cv/user_1/11111111-2222-4333-8444-555555555555.pdf";

const row = (statuses: string[]) => ({
  resumeKey: KEY,
  interviews: statuses.map((status, i) => ({ status, issuedConversationIds: [`conv_${i}a`, `conv_${i}b`] })),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  tx.resumeAnalysis.findFirst.mockResolvedValue(row(["COMPLETED", "FAILED"]));
  tx.resumeAnalysis.deleteMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteAnalysisRows", () => {
  it("reads the key and every issued conversation id, then deletes the analysis of that user, serializably", async () => {
    const result = await deleteAnalysisRows({ analysisId: ANALYSIS_ID, userId: "user_1", allowBusy: false });

    expect(result).toEqual({
      deleted: true,
      resumeKey: KEY,
      conversationIds: ["conv_0a", "conv_0b", "conv_1a", "conv_1b"],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.resumeAnalysis.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ANALYSIS_ID, userId: "user_1" } }),
    );
    expect(tx.resumeAnalysis.deleteMany).toHaveBeenCalledWith({ where: { id: ANALYSIS_ID, userId: "user_1" } });
  });

  it.each(["IN_PROGRESS", "GENERATING"])("refuses with ANALYSIS_BUSY while a rehearsal is %s, deleting nothing", async (status) => {
    tx.resumeAnalysis.findFirst.mockResolvedValue(row(["COMPLETED", status]));

    await expect(deleteAnalysisRows({ analysisId: ANALYSIS_ID, userId: "user_1", allowBusy: false })).rejects.toMatchObject({
      code: "ANALYSIS_BUSY",
    });
    expect(tx.resumeAnalysis.deleteMany).not.toHaveBeenCalled();
  });

  it("does not refuse when the account is gone: allowBusy deletes a live rehearsal with the rest", async () => {
    tx.resumeAnalysis.findFirst.mockResolvedValue(row(["IN_PROGRESS"]));

    const result = await deleteAnalysisRows({ analysisId: ANALYSIS_ID, userId: "user_1", allowBusy: true });

    expect(result).toMatchObject({ deleted: true, conversationIds: ["conv_0a", "conv_0b"] });
  });

  it("reports not deleted for a missing or foreign analysis, without deleting", async () => {
    tx.resumeAnalysis.findFirst.mockResolvedValue(null);

    expect(await deleteAnalysisRows({ analysisId: ANALYSIS_ID, userId: "user_2", allowBusy: false })).toEqual({ deleted: false });
    expect(tx.resumeAnalysis.deleteMany).not.toHaveBeenCalled();
  });

  it("retries once on a serialization failure", async () => {
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("raced", { code: "P2034", clientVersion: "test" }))
      .mockImplementationOnce(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);

    expect((await deleteAnalysisRows({ analysisId: ANALYSIS_ID, userId: "user_1", allowBusy: false })).deleted).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe("the account's rows", () => {
  it("lists the account's analyses and the conversations of interviews with no analysis", async () => {
    vi.mocked(prisma.resumeAnalysis.findMany).mockResolvedValue([{ id: "a1" }, { id: "a2" }] as never);
    vi.mocked(prisma.interview.findMany).mockResolvedValue([
      { issuedConversationIds: ["conv_x"] },
      { issuedConversationIds: [] },
    ] as never);

    expect(await listAnalysisIdsOfUser("user_1")).toEqual(["a1", "a2"]);
    expect(prisma.resumeAnalysis.findMany).toHaveBeenCalledWith({ where: { userId: "user_1" }, select: { id: true } });
    expect(await collectDetachedConversationIds("user_1")).toEqual(["conv_x"]);
    expect(prisma.interview.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1", resumeAnalysisId: null },
      select: { issuedConversationIds: true },
    });
  });
});
