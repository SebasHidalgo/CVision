import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectDetachedConversationIds,
  deleteAnalysisRows,
  listAnalysisIdsOfUser,
} from "@/lib/database/deletion";
import { deleteUserRows } from "@/lib/database/userById";
import { cancelSubscriptionNow } from "@/lib/billing";
import { deleteConversation } from "@/lib/elevenlabs/client";
import { AnalysisBusyError, VoiceUnavailableError } from "@/lib/error/errors";
import { listObjects, removeObject, removeObjects } from "@/lib/supabase/server";
import { deleteAccountCascade, deleteAnalysisCascade, PLATFORM_DELETE_CONCURRENCY } from "./deletion";

vi.mock("@/lib/database/deletion", () => ({
  deleteAnalysisRows: vi.fn(),
  listAnalysisIdsOfUser: vi.fn(),
  collectDetachedConversationIds: vi.fn(async () => []),
}));
vi.mock("@/lib/database/userById", () => ({ deleteUserRows: vi.fn(async () => true) }));
vi.mock("@/lib/billing", () => ({ cancelSubscriptionNow: vi.fn(async () => ({ canceled: [], failed: [] })) }));
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
  vi.mocked(cancelSubscriptionNow).mockResolvedValue({ canceled: [], failed: [] });
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

describe("platform deletes run in parallel, a few at a time", () => {
  it("keeps at most the concurrency limit in flight, settles every id, and logs each failure by id", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `conv_${i}`);
    vi.mocked(deleteAnalysisRows).mockResolvedValue({ deleted: true, resumeKey: KEY, conversationIds: ids });

    let inFlight = 0;
    let peak = 0;
    vi.mocked(deleteConversation).mockImplementation(async (id) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (id === "conv_3") throw new VoiceUnavailableError();
      return id === "conv_7" ? "not-found" : "deleted";
    });

    const outcome = await deleteAnalysisCascade({ analysisId: ANALYSIS_ID, userId: "user_1" });

    expect(PLATFORM_DELETE_CONCURRENCY).toBe(4);
    expect(peak).toBe(4);
    expect(deleteConversation).toHaveBeenCalledTimes(10);
    if (outcome.kind !== "deleted") throw new Error("expected deleted");
    expect(outcome.conversations.map((c) => c.id)).toEqual(ids);
    expect(outcome.conversations.find((c) => c.id === "conv_3")?.outcome).toBe("failed");
    expect(outcome.conversations.find((c) => c.id === "conv_7")?.outcome).toBe("not-found");
    expect(outcome.conversations.filter((c) => c.outcome === "deleted")).toHaveLength(8);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("conversation=conv_3"), expect.anything());
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
      subscriptionsCanceled: 0,
      subscriptionsFailed: 0,
      userRowRemoved: true,
    });
    // The user row goes last.
    expect(vi.mocked(deleteUserRows).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(removeObjects).mock.invocationCallOrder[0],
    );
  });

  it("cancels the billing subscriptions at the provider before any row goes, and counts them", async () => {
    vi.mocked(listAnalysisIdsOfUser).mockResolvedValue(["a1"]);
    vi.mocked(cancelSubscriptionNow).mockResolvedValue({ canceled: ["sub_01"], failed: [] });

    const summary = await deleteAccountCascade("user_1");

    expect(cancelSubscriptionNow).toHaveBeenCalledWith("user_1");
    expect(vi.mocked(cancelSubscriptionNow).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deleteAnalysisRows).mock.invocationCallOrder[0]);
    expect(vi.mocked(cancelSubscriptionNow).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deleteUserRows).mock.invocationCallOrder[0]);
    expect(summary).toMatchObject({ subscriptionsCanceled: 1, subscriptionsFailed: 0, userRowRemoved: true });
  });

  it("deletes the account even when the provider will not cancel, and says so loudly with the user id", async () => {
    vi.mocked(listAnalysisIdsOfUser).mockResolvedValue([]);
    vi.mocked(cancelSubscriptionNow).mockResolvedValue({ canceled: [], failed: ["sub_01"] });

    expect(await deleteAccountCascade("user_1")).toMatchObject({ subscriptionsCanceled: 0, subscriptionsFailed: 1, userRowRemoved: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/user=user_1 ACCOUNT DELETED WITH A SUBSCRIPTION POSSIBLY STILL BILLING/));

    vi.mocked(cancelSubscriptionNow).mockRejectedValue(new Error("db down"));
    expect(await deleteAccountCascade("user_1")).toMatchObject({ subscriptionsFailed: -1, userRowRemoved: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("user=user_1 could not read or cancel"), expect.anything());
  });

  it("is idempotent for an account already gone", async () => {
    vi.mocked(listAnalysisIdsOfUser).mockResolvedValue([]);
    vi.mocked(deleteUserRows).mockResolvedValue(false);

    expect(await deleteAccountCascade("user_gone")).toEqual({
      analyses: 0,
      leftoverObjects: 0,
      leftoverObjectsRemoved: true,
      conversationsFailed: 0,
      subscriptionsCanceled: 0,
      subscriptionsFailed: 0,
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
