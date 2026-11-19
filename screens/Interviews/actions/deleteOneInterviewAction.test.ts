import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { deleteInterviewCascade } from "@/lib/deletion";
import { AnalysisBusyError, UnauthorizedError } from "@/lib/error/errors";
import { deleteOneInterviewAction } from "./deleteOneInterviewAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/deletion", () => ({ deleteInterviewCascade: vi.fn() }));

const INTERVIEW_ID = "7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(deleteInterviewCascade).mockResolvedValue({ kind: "deleted", conversations: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteOneInterviewAction", () => {
  it("deletes the caller's interview through the cascade, scoped to the session user", async () => {
    expect(await deleteOneInterviewAction({ interviewId: INTERVIEW_ID })).toEqual({ ok: true, data: { deleted: true } });
    expect(deleteInterviewCascade).toHaveBeenCalledWith({ interviewId: INTERVIEW_ID, userId: "user_1" });
    expect(revalidatePath).toHaveBeenCalledWith("/interviews");
    expect(revalidatePath).toHaveBeenCalledWith("/resume/analyses");
  });

  it("answers NOT_FOUND for someone else's interview (the cascade finds nothing for this user)", async () => {
    vi.mocked(deleteInterviewCascade).mockResolvedValue({ kind: "not-found" });
    expect(await deleteOneInterviewAction({ interviewId: INTERVIEW_ID })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers ANALYSIS_BUSY while it is in a call or being scored", async () => {
    vi.mocked(deleteInterviewCascade).mockRejectedValue(new AnalysisBusyError("The interview is in progress"));
    expect(await deleteOneInterviewAction({ interviewId: INTERVIEW_ID })).toEqual({ ok: false, code: "ANALYSIS_BUSY" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers INVALID_INPUT for a bad id and UNAUTHORIZED without a session, deleting nothing", async () => {
    expect(await deleteOneInterviewAction({ interviewId: "nope" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await deleteOneInterviewAction({ resumeId: INTERVIEW_ID })).toEqual({ ok: false, code: "INVALID_INPUT" });
    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect(await deleteOneInterviewAction({ interviewId: INTERVIEW_ID })).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(deleteInterviewCascade).not.toHaveBeenCalled();
  });
});
