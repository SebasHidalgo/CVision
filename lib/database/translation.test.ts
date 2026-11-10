import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "u1") }));
vi.mock("@/lib/prisma", () => ({
  default: {
    resumeAnalysis: { count: vi.fn(async () => 1) },
    interviewFeedback: { count: vi.fn(async () => 1) },
    contentTranslation: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));

const prisma = (await import("@/lib/prisma")).default;
const { claimTranslation, completeTranslation, readOwnTranslation, TRANSLATION_CLAIM_STALE_MS, TRANSLATION_RETRY_AFTER_MS } = await import("./translation");

const NOW = new Date("2026-11-10T12:00:00Z");
const P2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" });
const row = (over: Record<string, unknown>) => ({ id: "t1", sourceHash: "h1", status: "PENDING", claimedAt: NOW, failedAt: null, updatedAt: NOW, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.resumeAnalysis.count).mockResolvedValue(1);
});

describe("claimTranslation", () => {
  it("claims by inserting the row, scoped to the owner", async () => {
    vi.mocked(prisma.contentTranslation.create).mockResolvedValue(row({}) as never);
    expect(await claimTranslation("u1", { analysisId: "a1" }, "es", "h1", NOW)).toMatchObject({ kind: "claimed" });
    expect(prisma.resumeAnalysis.count).toHaveBeenCalledWith({ where: { id: "a1", userId: "u1" } });
  });

  it("matches nothing for someone else's item", async () => {
    vi.mocked(prisma.resumeAnalysis.count).mockResolvedValue(0);
    expect(await claimTranslation("u1", { analysisId: "a1" }, "es", "h1", NOW)).toEqual({ kind: "missing" });
    expect(prisma.contentTranslation.create).not.toHaveBeenCalled();
  });

  it("leaves a fresh claim to the request that holds it, and serves a ready one", async () => {
    vi.mocked(prisma.contentTranslation.create).mockRejectedValue(P2002);
    vi.mocked(prisma.contentTranslation.findFirst).mockResolvedValueOnce(row({ claimedAt: new Date(NOW.getTime() - 5_000) }) as never);
    expect(await claimTranslation("u1", { analysisId: "a1" }, "es", "h1", NOW)).toEqual({ kind: "busy" });
    vi.mocked(prisma.contentTranslation.findFirst).mockResolvedValueOnce(row({ status: "READY" }) as never);
    expect(await claimTranslation("u1", { analysisId: "a1" }, "es", "h1", NOW)).toMatchObject({ kind: "ready" });
    expect(prisma.contentTranslation.updateMany).not.toHaveBeenCalled();
  });

  it("does not retry a recent failure, and takes over a stale claim, an old failure or changed content once", async () => {
    vi.mocked(prisma.contentTranslation.create).mockRejectedValue(P2002);
    vi.mocked(prisma.contentTranslation.findFirst).mockResolvedValueOnce(row({ status: "FAILED", failedAt: new Date(NOW.getTime() - 60_000) }) as never);
    expect(await claimTranslation("u1", { analysisId: "a1" }, "es", "h1", NOW)).toMatchObject({ kind: "failed" });

    for (const stale of [
      row({ claimedAt: new Date(NOW.getTime() - TRANSLATION_CLAIM_STALE_MS - 1) }),
      row({ status: "FAILED", failedAt: new Date(NOW.getTime() - TRANSLATION_RETRY_AFTER_MS - 1) }),
      row({ status: "READY", sourceHash: "old" }),
    ]) {
      vi.mocked(prisma.contentTranslation.findFirst).mockResolvedValueOnce(stale as never);
      vi.mocked(prisma.contentTranslation.updateMany).mockResolvedValueOnce({ count: 1 });
      expect(await claimTranslation("u1", { analysisId: "a1" }, "es", "h1", NOW)).toMatchObject({ kind: "claimed" });
      expect(vi.mocked(prisma.contentTranslation.updateMany).mock.lastCall?.[0]).toMatchObject({ where: { id: "t1", updatedAt: stale.updatedAt } });
    }

    // Two requests taking over the same row: the conditional update lets one through.
    vi.mocked(prisma.contentTranslation.findFirst).mockResolvedValueOnce(row({ status: "READY", sourceHash: "old" }) as never);
    vi.mocked(prisma.contentTranslation.updateMany).mockResolvedValueOnce({ count: 0 });
    expect(await claimTranslation("u1", { analysisId: "a1" }, "es", "h1", NOW)).toEqual({ kind: "busy" });
  });
});

describe("completeTranslation", () => {
  it("writes only while its claim is the current one", async () => {
    vi.mocked(prisma.contentTranslation.updateMany).mockResolvedValueOnce({ count: 0 });
    expect(await completeTranslation("t1", NOW, { payload: {}, guardStats: {}, model: "m", modelVersion: null })).toBe(false);
    expect(vi.mocked(prisma.contentTranslation.updateMany).mock.lastCall?.[0]).toMatchObject({ where: { id: "t1", status: "PENDING", claimedAt: NOW } });
  });
});

describe("readOwnTranslation", () => {
  it("reads through the session's owner", async () => {
    vi.mocked(prisma.contentTranslation.findFirst).mockResolvedValueOnce(null);
    await readOwnTranslation({ interviewFeedbackId: "f1" }, "es");
    expect(prisma.contentTranslation.findFirst).toHaveBeenCalledWith({ where: { interviewFeedbackId: "f1", interviewFeedback: { interview: { userId: "u1" } }, locale: "es" } });
  });
});
