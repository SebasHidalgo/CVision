import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { fetchHiddenInterviews } from "@/lib/database/interview";
import { deleteInterviewCascade } from "@/lib/deletion";
import { AnalysisBusyError, AppError, UnauthorizedError } from "@/lib/error/errors";
import { deleteHiddenInterviewsAction } from "./deleteHiddenInterviewsAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/database/interview", () => ({ fetchHiddenInterviews: vi.fn() }));
vi.mock("@/lib/deletion", () => ({ deleteInterviewCascade: vi.fn() }));

const id = (n: number) => `7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a${String(n).padStart(2, "0")}`;
const hidden = (n: number) => ({ id: id(n), role: `Role ${n}`, companyName: `Company ${n}`, createdAt: "2026-11-01T00:00:00.000Z" });
const deleted = { kind: "deleted" as const, conversations: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(fetchHiddenInterviews).mockResolvedValue([hidden(1), hidden(2), hidden(3)]);
  vi.mocked(deleteInterviewCascade).mockResolvedValue(deleted);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

const deletedIds = () => vi.mocked(deleteInterviewCascade).mock.calls.map(([params]) => params.interviewId);

describe("deleteHiddenInterviewsAction", () => {
  it("deletes every hidden interview the page showed, one cascade each, scoped to the session user", async () => {
    const result = await deleteHiddenInterviewsAction({ ids: [id(1), id(2), id(3)] });
    expect(result).toEqual({ ok: true, data: { deleted: 3, busy: 0, failed: 0, remaining: 0 } });
    expect(deletedIds()).toEqual([id(1), id(2), id(3)]);
    for (const [params] of vi.mocked(deleteInterviewCascade).mock.calls) expect(params).toEqual({ interviewId: params.interviewId, userId: "user_1" });
    expect(revalidatePath).toHaveBeenCalledWith("/interviews");
    expect(revalidatePath).toHaveBeenCalledWith("/resume/analyses");
  });

  it("acts on the hidden set read now: never one the page didn't show, never one that is no longer hidden or not the user's", async () => {
    // Since the page loaded: 3 was hidden (never shown as hidden), 2 became visible again (an upgrade).
    vi.mocked(fetchHiddenInterviews).mockResolvedValue([hidden(1), hidden(3)]);
    const foreign = "9e8d7c6b-5a49-4382-9172-6a5b4c3d2e1f";
    const result = await deleteHiddenInterviewsAction({ ids: [id(1), id(2), foreign] });
    expect(result).toEqual({ ok: true, data: { deleted: 1, busy: 0, failed: 0, remaining: 0 } });
    expect(deletedIds()).toEqual([id(1)]);
  });

  it("reports a live one as busy and keeps going; a failed one apart; one already gone as neither", async () => {
    vi.mocked(deleteInterviewCascade).mockImplementation(async ({ interviewId }) => {
      if (interviewId === id(1)) throw new AnalysisBusyError();
      if (interviewId === id(2)) throw new AppError("UNKNOWN", "database down");
      return deleted;
    });
    expect(await deleteHiddenInterviewsAction({ ids: [id(1), id(2), id(3)] })).toEqual({ ok: true, data: { deleted: 1, busy: 1, failed: 1, remaining: 0 } });
    expect(deletedIds()).toEqual([id(1), id(2), id(3)]);

    vi.mocked(deleteInterviewCascade).mockResolvedValue({ kind: "not-found" });
    expect(await deleteHiddenInterviewsAction({ ids: [id(1)] })).toEqual({ ok: true, data: { deleted: 0, busy: 0, failed: 0, remaining: 0 } });
  });

  it("stops starting deletions once its time budget is spent and says how many are left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(deleteInterviewCascade).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 25_000);
      return deleted;
    });
    const result = await deleteHiddenInterviewsAction({ ids: [id(1), id(2), id(3)] });
    expect(result).toEqual({ ok: true, data: { deleted: 2, busy: 0, failed: 0, remaining: 1 } });
    expect(deletedIds()).toEqual([id(1), id(2)]);
  });

  it("deletes nothing on bad input, without a session, or when the hidden set can't be read", async () => {
    expect(await deleteHiddenInterviewsAction({ ids: [] })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await deleteHiddenInterviewsAction({ ids: ["nope"] })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await deleteHiddenInterviewsAction({})).toEqual({ ok: false, code: "INVALID_INPUT" });

    vi.mocked(fetchHiddenInterviews).mockRejectedValueOnce(new AppError("UNKNOWN", "read failed"));
    expect(await deleteHiddenInterviewsAction({ ids: [id(1)] })).toEqual({ ok: false, code: "UNKNOWN" });

    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect(await deleteHiddenInterviewsAction({ ids: [id(1)] })).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(deleteInterviewCascade).not.toHaveBeenCalled();
  });
});
