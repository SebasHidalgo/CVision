import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { deleteAnalysisCascade } from "@/lib/deletion";
import { AnalysisBusyError, UnauthorizedError } from "@/lib/error/errors";
import { deleteOneAnalysisAction } from "./deleteOneAnalysisAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/deletion", () => ({ deleteAnalysisCascade: vi.fn() }));

const HIDDEN_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(deleteAnalysisCascade).mockResolvedValue({ kind: "deleted", objectRemoved: true, conversations: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteOneAnalysisAction", () => {
  it("deletes the caller's analysis through the cascade, scoped to the session user, with the busy refusal on", async () => {
    expect(await deleteOneAnalysisAction({ resumeId: HIDDEN_ID })).toEqual({ ok: true, data: { deleted: true } });
    // No visibility check in the way: ownership (the cascade's where) is the only gate.
    expect(deleteAnalysisCascade).toHaveBeenCalledWith({ analysisId: HIDDEN_ID, userId: "user_1" });
    expect(revalidatePath).toHaveBeenCalledWith("/resume/analyses");
    expect(revalidatePath).toHaveBeenCalledWith("/interviews");
  });

  it("answers NOT_FOUND for someone else's analysis (the cascade finds nothing for this user)", async () => {
    vi.mocked(deleteAnalysisCascade).mockResolvedValue({ kind: "not-found" });
    expect(await deleteOneAnalysisAction({ resumeId: HIDDEN_ID })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers ANALYSIS_BUSY while a rehearsal of it is live", async () => {
    vi.mocked(deleteAnalysisCascade).mockRejectedValue(new AnalysisBusyError());
    expect(await deleteOneAnalysisAction({ resumeId: HIDDEN_ID })).toEqual({ ok: false, code: "ANALYSIS_BUSY" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers INVALID_INPUT for a bad id and UNAUTHORIZED without a session, deleting nothing", async () => {
    expect(await deleteOneAnalysisAction({ resumeId: "nope" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect(await deleteOneAnalysisAction({ resumeId: HIDDEN_ID })).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(deleteAnalysisCascade).not.toHaveBeenCalled();
  });
});
