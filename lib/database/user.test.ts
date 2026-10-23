import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/error/errors";
import { ensureUser } from "./user";
import { deleteUserRows, upsertUserById } from "./userById";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: { user: { upsert: vi.fn(), deleteMany: vi.fn() } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1", compPlan: null, createdAt: new Date(), updatedAt: new Date() });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ensureUser", () => {
  it("upserts the caller's own row, with nothing to update on a later call", async () => {
    expect(await ensureUser()).toBe("user_1");
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { id: "user_1" },
      create: { id: "user_1" },
      update: {},
    });
  });

  it("takes the id from the session, never from a caller", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    await expect(ensureUser()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});

describe("the webhook's session-less writes", () => {
  it("upserts by the id the signed delivery named", async () => {
    await upsertUserById("user_9");
    expect(prisma.user.upsert).toHaveBeenCalledWith({ where: { id: "user_9" }, create: { id: "user_9" }, update: {} });
    expect(requireUserId).not.toHaveBeenCalled();
  });

  it("deletes the row and reports whether there was one, so a retry is a no-op", async () => {
    vi.mocked(prisma.user.deleteMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await deleteUserRows("user_9")).toBe(true);
    expect(await deleteUserRows("user_9")).toBe(false);
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { id: "user_9" } });
  });
});
