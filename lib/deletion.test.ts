import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectDetachedConversationIds,
  deleteAnalysisRows,
  listAnalysisIdsOfUser,
} from "@/lib/database/deletion";
import { deleteUserRows } from "@/lib/database/user";
import { deleteConversation } from "@/lib/elevenlabs/client";
import { AnalysisBusyError, VoiceUnavailableError } from "@/lib/error/errors";
import { listObjects, removeObject, removeObjects } from "@/lib/supabase/server";
import { deleteAccountCascade, deleteAnalysisCascade } from "./deletion";

vi.mock("@/lib/database/deletion", () => ({
  deleteAnalysisRows: vi.fn(),
  listAnalysisIdsOfUser: vi.fn(),
  collectDetachedConversationIds: vi.fn(async () => []),
}));
vi.mock("@/lib/database/user", () => ({ deleteUserRows: vi.fn(async () => true) }));
vi.mock("@/lib/elevenlabs/client", () => ({ deleteConversation: vi.fn(async () => "deleted") }));
vi.mock("@/lib/supabase/server", () => ({
  removeObject: vi.fn(async () => true),
  removeObjects: vi.fn(async () => {}),
  listObjects: vi.fn(async () => []),
}));

const ANALYSIS_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const KEY = "cv/user_1/11111111-2222-4333-8444-555555555555.pdf";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteAnalysisRows).mockResolvedValue({ deleted: true, resumeKey: KEY, conversationIds: ["conv_1", "conv_2", "conv_1"] });
  vi.mocked(deleteConversation).mockResolvedValue("deleted");
  vi.mocked(removeObject).mockResolvedValue(true);
  vi.mocked(listObjects).mockResolvedValue([]);
  vi.mocked(deleteUserRows).mockResolvedValue(true);
  for (const method of ["info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

describe("deleteAnalysisCascade", () => {
  it("deletes the rows first, then the CV object and each conversation once", async () => {
    const outcome = await deleteAnalysisCascade({ analysisId: ANALYSIS_ID, userId: "user_1" });

    expect(deleteAnalysisRows).toHaveBeenCalledWith({ analysisId: ANALYSIS_ID, userId: "user_1", allowBusy: false });
    expect(removeObject).toHaveBeenCalledWith(KEY);
    expect(deleteConversation).toHaveBeenCalledTimes(2);
    expect(deleteConversation).toHaveBeenCalledWith("conv_1");
    expect(deleteConversation).toHaveBeenCalledWith("conv_2");
    expect(outcome).toEqual({
      kind: "deleted",
      objectRemoved: true,
      conversations: [
        { id: "conv_1", outcome: "deleted" },
        { id: "conv_2", outcome: "deleted" },
      ],
    });
    // Rows went before anything external was touched.
    const order = [deleteAnalysisRows, removeObject, deleteConversation].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("lets the busy refusal through untouched, before anything external", async () => {
    vi.mocked(deleteAnalysisRows).mockRejectedValue(new AnalysisBusyError());

    await expect(deleteAnalysisCascade({ analysisId: ANALYSIS_ID, userId: "user_1" })).rejects.toMatchObject({ code: "ANALYSIS_BUSY" });
    expect(removeObject).not.toHaveBeenCalled();
    expect(deleteConversation).not.toHaveBeenCalled();
  });

  it("touches nothing external for an analysis that is not there", async () => {
    vi.mocked(deleteAnalysisRows).mockResolvedValue({ deleted: false });

    expect(await deleteAnalysisCascade({ analysisId: ANALYSIS_ID, userId: "user_1" })).toEqual({ kind: "not-found" });
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("reports an external failure without undoing the deletion: the rows stay gone", async () => {
    vi.mocked(removeObject).mockResolvedValue(false);
    vi.mocked(deleteConversation).mockRejectedValueOnce(new VoiceUnavailableError()).mockResolvedValueOnce("not-found");

    const outcome = await deleteAnalysisCascade({ analysisId: ANALYSIS_ID, userId: "user_1" });

    expect(outcome).toEqual({
      kind: "deleted",
      objectRemoved: false,
      conversations: [
        { id: "conv_1", outcome: "failed" },
        { id: "conv_2", outcome: "not-found" },
      ],
    });
    expect(deleteAnalysisRows).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("conversation=conv_1"), expect.anything());
  });
});

describe("deleteAccountCascade", () => {
  it("walks every analysis without the busy refusal, then detached conversations, leftover objects and the user row", async () => {
    vi.mocked(listAnalysisIdsOfUser).mockResolvedValue(["a1", "a2"]);
    vi.mocked(deleteAnalysisRows)
      .mockResolvedValueOnce({ deleted: true, resumeKey: "cv/user_1/a.pdf", conversationIds: ["conv_a"] })
      .mockResolvedValueOnce({ deleted: true, resumeKey: "cv/user_1/b.pdf", conversationIds: ["conv_live"] });
    vi.mocked(collectDetachedConversationIds).mockResolvedValue(["conv_detached"]);
    vi.mocked(listObjects).mockResolvedValue([
      { key: "cv/user_1/stray.pdf", size: 10, createdAt: null },
      { key: "cv/user_1/stray2.pdf", size: 10, createdAt: null },
    ]);

    const summary = await deleteAccountCascade("user_1");

    expect(deleteAnalysisRows).toHaveBeenNthCalledWith(1, { analysisId: "a1", userId: "user_1", allowBusy: true });
    expect(deleteAnalysisRows).toHaveBeenNthCalledWith(2, { analysisId: "a2", userId: "user_1", allowBusy: true });
    expect(removeObject).toHaveBeenCalledWith("cv/user_1/a.pdf");
    expect(removeObject).toHaveBeenCalledWith("cv/user_1/b.pdf");
    expect(deleteConversation).toHaveBeenCalledWith("conv_a");
    expect(deleteConversation).toHaveBeenCalledWith("conv_live");
    expect(deleteConversation).toHaveBeenCalledWith("conv_detached");
    expect(listObjects).toHaveBeenCalledWith("cv/user_1");
    expect(removeObjects).toHaveBeenCalledWith(["cv/user_1/stray.pdf", "cv/user_1/stray2.pdf"]);
    expect(deleteUserRows).toHaveBeenCalledWith("user_1");
    expect(summary).toEqual({
      analyses: 2,
      leftoverObjects: 2,
      leftoverObjectsRemoved: true,
      conversationsFailed: 0,
      userRowRemoved: true,
    });
    // The user row goes last.
    expect(vi.mocked(deleteUserRows).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(removeObjects).mock.invocationCallOrder[0],
    );
  });

  it("is idempotent for an account already gone", async () => {
    vi.mocked(listAnalysisIdsOfUser).mockResolvedValue([]);
    vi.mocked(deleteUserRows).mockResolvedValue(false);

    expect(await deleteAccountCascade("user_gone")).toEqual({
      analyses: 0,
      leftoverObjects: 0,
      leftoverObjectsRemoved: true,
      conversationsFailed: 0,
      userRowRemoved: false,
    });
  });

  it("still removes the user row when storage fails on the leftovers, and says so", async () => {
    vi.mocked(listAnalysisIdsOfUser).mockResolvedValue([]);
    vi.mocked(listObjects).mockRejectedValue(new Error("storage down"));

    const summary = await deleteAccountCascade("user_1");

    expect(summary.leftoverObjectsRemoved).toBe(false);
    expect(deleteUserRows).toHaveBeenCalledWith("user_1");
  });
});
