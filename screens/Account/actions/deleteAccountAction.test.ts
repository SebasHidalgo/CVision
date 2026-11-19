import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { ClerkDeleteError, deleteClerkUser } from "@/lib/clerk/users";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { deleteAccountCascade, type AccountDeletion } from "@/lib/deletion";
import { RateLimitedError, UnauthorizedError } from "@/lib/error/errors";
import { deleteAccountAction } from "./deleteAccountAction";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn() }));
vi.mock("@/lib/deletion", () => ({ deleteAccountCascade: vi.fn() }));
vi.mock("@/lib/clerk/users", async (original) => ({ ...(await original<typeof import("@/lib/clerk/users")>()), deleteClerkUser: vi.fn() }));

const DONE: AccountDeletion = {
  analyses: 2,
  leftoverObjects: 0,
  leftoverObjectsRemoved: true,
  objectsRemoved: 2,
  conversationsDeleted: 1,
  conversationsFailed: 0,
  subscriptionsCanceled: 1,
  subscriptionsFailed: 0,
  userRowRemoved: true,
};

const order: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_secret");
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(assertRateLimit).mockImplementation(async () => void order.push("rate limit"));
  vi.mocked(deleteClerkUser).mockImplementation(async () => {
    order.push("clerk");
    return "deleted";
  });
  vi.mocked(deleteAccountCascade).mockImplementation(async () => {
    order.push("cascade");
    return DONE;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("deleteAccountAction", () => {
  it("deletes the session's account at Clerk first, then everything of it here", async () => {
    expect(await deleteAccountAction({ confirm: true })).toEqual({ ok: true, data: { deleted: true } });
    expect(order).toEqual(["rate limit", "clerk", "cascade"]);
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "accountDeletion");
    expect(deleteClerkUser).toHaveBeenCalledWith("user_1", { secretKey: "sk_test_secret" });
    expect(deleteAccountCascade).toHaveBeenCalledWith("user_1");
  });

  it("goes on when Clerk no longer has the account: the rest is still ours to delete", async () => {
    vi.mocked(deleteClerkUser).mockResolvedValueOnce("already-gone");
    expect(await deleteAccountAction({ confirm: true })).toEqual({ ok: true, data: { deleted: true } });
    expect(deleteAccountCascade).toHaveBeenCalledWith("user_1");
  });

  it("deletes nothing here when Clerk does not confirm, and says so with its own code", async () => {
    vi.mocked(deleteClerkUser).mockRejectedValueOnce(new ClerkDeleteError("delete: HTTP 503"));
    expect(await deleteAccountAction({ confirm: true })).toEqual({ ok: false, code: "ACCOUNT_DELETION_FAILED" });
    expect(deleteAccountCascade).not.toHaveBeenCalled();
  });

  it("answers ok when the account is gone at Clerk but the local cascade fails: logged, left to the webhook and the reconcile", async () => {
    vi.mocked(deleteAccountCascade).mockRejectedValueOnce(new Error("P2034"));
    expect(await deleteAccountAction({ confirm: true })).toEqual({ ok: true, data: { deleted: true } });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("user=user_1 DELETED AT CLERK BUT THE LOCAL CASCADE FAILED"), expect.any(Error));
  });

  it("is rate-limited before anything is deleted", async () => {
    vi.mocked(assertRateLimit).mockRejectedValueOnce(new RateLimitedError(1200));
    expect(await deleteAccountAction({ confirm: true })).toEqual({ ok: false, code: "RATE_LIMITED", meta: { retryAfter: 1200 } });
    expect(deleteClerkUser).not.toHaveBeenCalled();
    expect(deleteAccountCascade).not.toHaveBeenCalled();
  });

  it("needs an explicit yes, and a session; it never takes an id from the browser", async () => {
    for (const input of [{}, { confirm: "true" }, { confirm: false }, null, { confirm: true, userId: "user_2" }]) {
      const result = await deleteAccountAction(input);
      if (result.ok) {
        // Extra keys are ignored: the session's account is the one deleted.
        expect(deleteClerkUser).toHaveBeenLastCalledWith("user_1", expect.anything());
      } else {
        expect(result).toEqual({ ok: false, code: "INVALID_INPUT" });
      }
    }
    expect(deleteAccountCascade).not.toHaveBeenCalledWith("user_2");

    vi.clearAllMocks();
    vi.mocked(requireUserId).mockRejectedValueOnce(new UnauthorizedError());
    expect(await deleteAccountAction({ confirm: true })).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(deleteClerkUser).not.toHaveBeenCalled();
  });
});
