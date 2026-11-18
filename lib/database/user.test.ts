import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/error/errors";
import { ensureUser } from "./user";
import { countUsersCreatedSince, deleteUserRows, listUsersCreatedBefore, upsertUserById } from "./userById";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: { user: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "user_1", compPlan: null, locale: null, callOverruns: 0, createdAt: new Date(), updatedAt: new Date() });
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

describe("the reconcile's reads", () => {
  const cutoff = new Date("2026-11-17T12:00:00Z");

  it("pages through accounts older than the cutoff in id order, after the cursor", async () => {
    await listUsersCreatedBefore({ createdBefore: cutoff, afterId: null, take: 100 });
    expect(prisma.user.findMany).toHaveBeenLastCalledWith({
      where: { createdAt: { lt: cutoff } },
      orderBy: { id: "asc" },
      take: 100,
      select: { id: true, createdAt: true },
    });

    await listUsersCreatedBefore({ createdBefore: cutoff, afterId: "user_5", take: 100 });
    expect(prisma.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { createdAt: { lt: cutoff }, id: { gt: "user_5" } } }));
  });

  it("counts the accounts the cutoff leaves out", async () => {
    vi.mocked(prisma.user.count).mockResolvedValueOnce(3);
    expect(await countUsersCreatedSince(cutoff)).toBe(3);
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { createdAt: { gte: cutoff } } });
  });
});
