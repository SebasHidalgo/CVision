import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { fetchHiddenResumes } from "@/lib/database/resume";
import { deleteAnalysisCascade } from "@/lib/deletion";
import { AnalysisBusyError, AppError, UnauthorizedError } from "@/lib/error/errors";
import { deleteHiddenAnalysesAction } from "./deleteHiddenAnalysesAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/database/resume", () => ({ fetchHiddenResumes: vi.fn() }));
vi.mock("@/lib/deletion", () => ({ deleteAnalysisCascade: vi.fn() }));

const id = (n: number) => `3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b${String(n).padStart(2, "0")}`;
const hidden = (n: number) => ({ id: id(n), jobTitle: `Role ${n}`, companyName: `Company ${n}`, createdAt: "2026-11-01T00:00:00.000Z" });
const deleted = { kind: "deleted" as const, objectRemoved: true, conversations: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(fetchHiddenResumes).mockResolvedValue([hidden(1), hidden(2), hidden(3)]);
  vi.mocked(deleteAnalysisCascade).mockResolvedValue(deleted);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

const deletedIds = () => vi.mocked(deleteAnalysisCascade).mock.calls.map(([params]) => params.analysisId);

describe("deleteHiddenAnalysesAction", () => {
  it("deletes every hidden analysis the page showed, one cascade each, scoped to the session user", async () => {
    const result = await deleteHiddenAnalysesAction({ ids: [id(1), id(2), id(3)] });
    expect(result).toEqual({ ok: true, data: { deleted: 3, busy: 0, failed: 0, remaining: 0 } });
    expect(deletedIds()).toEqual([id(1), id(2), id(3)]);
    for (const [params] of vi.mocked(deleteAnalysisCascade).mock.calls) expect(params).toEqual({ analysisId: params.analysisId, userId: "user_1" });
    expect(revalidatePath).toHaveBeenCalledWith("/resume/analyses");
    expect(revalidatePath).toHaveBeenCalledWith("/interviews");
  });

  it("acts on the hidden set read now: never one the page didn't show, never one that is no longer hidden or not the user's", async () => {
    // Since the page loaded: 3 was pushed out of the last three (never shown as hidden), 2 became visible again.
    vi.mocked(fetchHiddenResumes).mockResolvedValue([hidden(1), hidden(3)]);
    const foreign = "9e8d7c6b-5a49-4382-9172-6a5b4c3d2e1f";
    const result = await deleteHiddenAnalysesAction({ ids: [id(1), id(2), foreign] });
    expect(result).toEqual({ ok: true, data: { deleted: 1, busy: 0, failed: 0, remaining: 0 } });
    expect(deletedIds()).toEqual([id(1)]);
  });

  it("reports a busy one and keeps going", async () => {
    vi.mocked(deleteAnalysisCascade).mockImplementation(async ({ analysisId }) => {
      if (analysisId === id(2)) throw new AnalysisBusyError();
      return deleted;
    });
    const result = await deleteHiddenAnalysesAction({ ids: [id(1), id(2), id(3)] });
    expect(result).toEqual({ ok: true, data: { deleted: 2, busy: 1, failed: 0, remaining: 0 } });
    expect(deletedIds()).toEqual([id(1), id(2), id(3)]);
  });

  it("counts a failed one apart from a busy one, and one already gone as neither", async () => {
    vi.mocked(deleteAnalysisCascade).mockImplementation(async ({ analysisId }) => {
      if (analysisId === id(1)) throw new AppError("UNKNOWN", "database down");
      if (analysisId === id(2)) return { kind: "not-found" };
      return deleted;
    });
    const result = await deleteHiddenAnalysesAction({ ids: [id(1), id(2), id(3)] });
    expect(result).toEqual({ ok: true, data: { deleted: 1, busy: 0, failed: 1, remaining: 0 } });
  });

  it("stops starting deletions once its time budget is spent and says how many are left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(deleteAnalysisCascade).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 25_000);
      return deleted;
    });
    const result = await deleteHiddenAnalysesAction({ ids: [id(1), id(2), id(3)] });
    expect(result).toEqual({ ok: true, data: { deleted: 2, busy: 0, failed: 0, remaining: 1 } });
    expect(deletedIds()).toEqual([id(1), id(2)]);
  });

  it("deletes nothing on bad input, without a session, or when the hidden set can't be read", async () => {
    expect(await deleteHiddenAnalysesAction({ ids: [] })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await deleteHiddenAnalysesAction({ ids: ["nope"] })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await deleteHiddenAnalysesAction({})).toEqual({ ok: false, code: "INVALID_INPUT" });

    vi.mocked(fetchHiddenResumes).mockRejectedValueOnce(new AppError("UNKNOWN", "read failed"));
    expect(await deleteHiddenAnalysesAction({ ids: [id(1)] })).toEqual({ ok: false, code: "UNKNOWN" });

    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect(await deleteHiddenAnalysesAction({ ids: [id(1)] })).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(deleteAnalysisCascade).not.toHaveBeenCalled();
  });
});
