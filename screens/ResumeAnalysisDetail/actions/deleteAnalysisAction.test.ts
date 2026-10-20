import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { deleteAnalysisCascade } from "@/lib/deletion";
import { AnalysisBusyError, UnauthorizedError } from "@/lib/error/errors";
import { deleteAnalysisAction } from "./deleteAnalysisAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/deletion", () => ({ deleteAnalysisCascade: vi.fn() }));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(deleteAnalysisCascade).mockResolvedValue({ kind: "deleted", objectRemoved: true, conversations: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteAnalysisAction", () => {
  it("deletes the caller's analysis with the busy refusal on, and revalidates the lists", async () => {
    expect(await deleteAnalysisAction({ resumeId: RESUME_ID })).toEqual({ ok: true, data: { deleted: true } });
    expect(deleteAnalysisCascade).toHaveBeenCalledWith({ analysisId: RESUME_ID, userId: "user_1" });
    expect(revalidatePath).toHaveBeenCalledWith("/resume/analyses");
    expect(revalidatePath).toHaveBeenCalledWith("/interviews");
  });

  it("answers ANALYSIS_BUSY while a rehearsal is live", async () => {
    vi.mocked(deleteAnalysisCascade).mockRejectedValue(new AnalysisBusyError());
    expect(await deleteAnalysisAction({ resumeId: RESUME_ID })).toEqual({ ok: false, code: "ANALYSIS_BUSY" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND for a missing or foreign analysis, INVALID_INPUT for a bad id, UNAUTHORIZED without a session", async () => {
    vi.mocked(deleteAnalysisCascade).mockResolvedValue({ kind: "not-found" });
    expect(await deleteAnalysisAction({ resumeId: RESUME_ID })).toEqual({ ok: false, code: "NOT_FOUND" });

    expect(await deleteAnalysisAction({ resumeId: "nope" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(deleteAnalysisCascade).toHaveBeenCalledTimes(1);

    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect(await deleteAnalysisAction({ resumeId: RESUME_ID })).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});
