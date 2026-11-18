import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { getOptionalUserId } from "@/lib/auth";
import { savedLocale } from "./locale";

vi.mock("@/lib/auth", () => ({ getOptionalUserId: vi.fn(), requireUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn(), upsert: vi.fn() } } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("savedLocale", () => {
  it("reads the signed-in user's saved language", async () => {
    vi.mocked(getOptionalUserId).mockResolvedValue("user_1");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ locale: "es" } as never);
    expect(await savedLocale()).toBe("es");
  });

  it("is null for a visitor, without a query", async () => {
    vi.mocked(getOptionalUserId).mockResolvedValue(null);
    expect(await savedLocale()).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("is null when the session cannot be read (a missing static file renders without the proxy), so the 404 stays a 404", async () => {
    vi.mocked(getOptionalUserId).mockRejectedValue(new Error("Clerk: auth() was called but Clerk can't detect usage of clerkMiddleware()."));
    expect(await savedLocale()).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("lets Next's control flow through (the dynamic-render bailout)", async () => {
    const bailout = Object.assign(new Error("Dynamic server usage"), { digest: "DYNAMIC_SERVER_USAGE" });
    vi.mocked(getOptionalUserId).mockRejectedValue(bailout);
    await expect(savedLocale()).rejects.toBe(bailout);
  });

  it("reads a failed query as null, logged", async () => {
    vi.mocked(getOptionalUserId).mockResolvedValue("user_1");
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("pool exhausted"));
    expect(await savedLocale()).toBeNull();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
