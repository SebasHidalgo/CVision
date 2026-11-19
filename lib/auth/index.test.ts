import { describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: clerk.auth, currentUser: vi.fn() }));

import { getOptionalUserIdOutsideProxy } from "./index";

describe("getOptionalUserIdOutsideProxy", () => {
  it("is the session's user id when the middleware ran", async () => {
    clerk.auth.mockResolvedValueOnce({ userId: "user_1" });
    expect(await getOptionalUserIdOutsideProxy()).toBe("user_1");
  });

  it("is null for a visitor", async () => {
    clerk.auth.mockResolvedValueOnce({ userId: null });
    expect(await getOptionalUserIdOutsideProxy()).toBeNull();
  });

  it("is null when the proxy skipped the request and reading the session throws", async () => {
    clerk.auth.mockRejectedValueOnce(new Error("auth() was called but Clerk can't detect usage of clerkMiddleware()"));
    expect(await getOptionalUserIdOutsideProxy()).toBeNull();
  });

  it("rethrows Next's control flow", async () => {
    const bailout = Object.assign(new Error("Dynamic server usage"), { digest: "DYNAMIC_SERVER_USAGE" });
    clerk.auth.mockRejectedValueOnce(bailout);
    await expect(getOptionalUserIdOutsideProxy()).rejects.toBe(bailout);
  });
});
