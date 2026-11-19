import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { getOptionalUserIdOutsideProxy } from "@/lib/auth";
import { savedLocale } from "./locale";

vi.mock("@/lib/auth", () => ({ getOptionalUserIdOutsideProxy: vi.fn(), requireUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn(), upsert: vi.fn() } } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("savedLocale", () => {
  it("reads the signed-in user's saved language", async () => {
    vi.mocked(getOptionalUserIdOutsideProxy).mockResolvedValue("user_1");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ locale: "es" } as never);
    expect(await savedLocale()).toBe("es");
  });

  it("is null for a visitor, without a query", async () => {
    vi.mocked(getOptionalUserIdOutsideProxy).mockResolvedValue(null);
    expect(await savedLocale()).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("reads a failed query as null, logged", async () => {
    vi.mocked(getOptionalUserIdOutsideProxy).mockResolvedValue("user_1");
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("pool exhausted"));
    expect(await savedLocale()).toBeNull();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
