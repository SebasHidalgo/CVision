import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PLANS } from "@/lib/plans";
import { resolvePlanStanding } from "./billing";
import { fetchHiddenResumes, fetchVisibleResumes } from "./resume";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("./billing", () => ({ resolvePlanStanding: vi.fn() }));
vi.mock("./mappers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mappers")>();
  return { ...actual, mapDbResume: (row: { id: string }) => ({ id: row.id }) };
});
vi.mock("@/lib/prisma", () => ({ default: { resumeAnalysis: { findMany: vi.fn() } } }));

const standing = (plan: "FREE" | "PRO") => ({ plan, source: "free", subscription: null, everSubscribed: false }) as never;
const row = (id: string, day: number) => ({ id, jobTitle: `Role ${id}`, companyName: `Company ${id}`, createdAt: new Date(Date.UTC(2026, 10, day)) });
/** Five analyses of user_1, newest first. */
const ALL = [row("a5", 5), row("a4", 4), row("a3", 3), row("a2", 2), row("a1", 1)];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(resolvePlanStanding).mockResolvedValue(standing("FREE"));
  // Answers like the database would for user_1 only: a where on anyone else matches nothing.
  vi.mocked(prisma.resumeAnalysis.findMany).mockImplementation((async (args: { where: { userId: string }; take?: number; skip?: number }) => {
    if (args.where.userId !== "user_1") return [];
    if (args.take !== undefined) return ALL.slice(0, args.take);
    if (args.skip !== undefined) return ALL.slice(args.skip);
    return ALL;
  }) as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("fetchHiddenResumes", () => {
  it("is the session user's analyses beyond Free's history, newest first, in one read", async () => {
    expect(await fetchHiddenResumes()).toEqual([
      { id: "a2", jobTitle: "Role a2", companyName: "Company a2", createdAt: "2026-11-02T00:00:00.000Z" },
      { id: "a1", jobTitle: "Role a1", companyName: "Company a1", createdAt: "2026-11-01T00:00:00.000Z" },
    ]);
    // Ownership in the where, the visible ones skipped in the same query, only what the list shows.
    expect(prisma.resumeAnalysis.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.resumeAnalysis.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: PLANS.FREE.historyLimit,
      select: { id: true, jobTitle: true, companyName: true, createdAt: true },
    });
    expect(resolvePlanStanding).toHaveBeenCalledWith("user_1", expect.any(Date));
  });

  it("is someone else's nothing: the identity is the session's, never an argument", async () => {
    vi.mocked(requireUserId).mockResolvedValue("user_2");
    expect(await fetchHiddenResumes()).toEqual([]);
    expect(prisma.resumeAnalysis.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user_2" } }));
  });

  it("is empty for Pro without reading the analyses", async () => {
    vi.mocked(resolvePlanStanding).mockResolvedValue(standing("PRO"));
    expect(await fetchHiddenResumes()).toEqual([]);
    expect(prisma.resumeAnalysis.findMany).not.toHaveBeenCalled();
  });

  it("is empty for Free with no more than the history limit", async () => {
    vi.mocked(prisma.resumeAnalysis.findMany).mockResolvedValue([]);
    expect(await fetchHiddenResumes()).toEqual([]);
  });
});

describe("fetchVisibleResumes", () => {
  it("returns the hidden ones beside the visible ones, the count unchanged", async () => {
    const free = await fetchVisibleResumes();
    expect(free.analyses.map((a) => a.id)).toEqual(["a5", "a4", "a3"]);
    expect(free.hidden).toBe(2);
    expect(free.hiddenAnalyses.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(free.hiddenAnalyses[0]).toEqual({ id: "a2", jobTitle: "Role a2", companyName: "Company a2", createdAt: "2026-11-02T00:00:00.000Z" });

    vi.mocked(resolvePlanStanding).mockResolvedValue(standing("PRO"));
    const pro = await fetchVisibleResumes();
    expect(pro.hidden).toBe(0);
    expect(pro.hiddenAnalyses).toEqual([]);
  });
});
