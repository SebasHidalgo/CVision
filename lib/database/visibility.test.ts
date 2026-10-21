import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { PLANS } from "@/lib/plans";
import { resolvePlanStanding } from "./billing";
import { fetchVisibleInterviews, fetchInterviewById } from "./interview";
import { fetchResumeAccess, fetchResumeById, fetchVisibleResumes } from "./resume";
import { isVisible, visibleAnalysisIds } from "./visibility";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("./billing", () => ({ resolvePlanStanding: vi.fn() }));
vi.mock("./interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn(async () => 0) }));
vi.mock("./mappers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mappers")>();
  return {
    ...actual,
    mapDbResume: (row: { id: string }) => ({ id: row.id }),
    mapDbInterview: (row: { id: string; resumeAnalysisId: string | null }) => ({ id: row.id, resumeAnalysisId: row.resumeAnalysisId }),
  };
});
vi.mock("@/lib/prisma", () => ({
  default: {
    resumeAnalysis: { findMany: vi.fn(), findFirst: vi.fn() },
    interview: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

const standing = (plan: "FREE" | "PRO") => ({ plan, source: "free", subscription: null, everSubscribed: false }) as never;
/** Five analyses, newest first. */
const ALL = ["a5", "a4", "a3", "a2", "a1"].map((id) => ({ id }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolvePlanStanding).mockResolvedValue(standing("FREE"));
  vi.mocked(prisma.resumeAnalysis.findMany).mockImplementation((async (args: { take?: number }) =>
    args?.take ? ALL.slice(0, args.take) : ALL) as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("visibleAnalysisIds", () => {
  it("is the Free account's three most recent, and everything for Pro", async () => {
    expect(await visibleAnalysisIds("user_1")).toEqual(new Set(["a5", "a4", "a3"]));
    expect(prisma.resumeAnalysis.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      orderBy: { createdAt: "desc" },
      take: PLANS.FREE.historyLimit,
      select: { id: true },
    });

    vi.mocked(resolvePlanStanding).mockResolvedValue(standing("PRO"));
    expect(await visibleAnalysisIds("user_1")).toBeNull();
  });

  it("isVisible: everything when there is no limit, and an interview without an analysis is never hidden", () => {
    expect(isVisible(null, "any")).toBe(true);
    expect(isVisible(new Set(["a5"]), "a5")).toBe(true);
    expect(isVisible(new Set(["a5"]), "a1")).toBe(false);
    expect(isVisible(new Set(["a5"]), null)).toBe(true);
  });
});

describe("the lists", () => {
  it("fetchVisibleResumes hides the older ones for Free and counts them; Pro sees all", async () => {
    const free = await fetchVisibleResumes();
    expect(free.analyses.map((a) => a.id)).toEqual(["a5", "a4", "a3"]);
    expect(free.hidden).toBe(2);

    vi.mocked(resolvePlanStanding).mockResolvedValue(standing("PRO"));
    const pro = await fetchVisibleResumes();
    expect(pro.analyses).toHaveLength(5);
    expect(pro.hidden).toBe(0);
  });

  it("fetchVisibleInterviews hides the interviews of hidden analyses, keeps detached ones", async () => {
    vi.mocked(prisma.interview.findMany).mockResolvedValue([
      { id: "i1", resumeAnalysisId: "a5" },
      { id: "i2", resumeAnalysisId: "a1" },
      { id: "i3", resumeAnalysisId: null },
    ] as never);

    const { interviews, hidden } = await fetchVisibleInterviews();
    expect(interviews.map((i) => i.id)).toEqual(["i1", "i3"]);
    expect(hidden).toBe(1);
  });
});

describe("the pages", () => {
  it("fetchResumeAccess tells a hidden analysis apart from a missing one; fetchResumeById folds both into null", async () => {
    vi.mocked(prisma.resumeAnalysis.findFirst).mockResolvedValueOnce({ id: "a1" } as never);
    expect(await fetchResumeAccess("a1")).toEqual({ kind: "hidden" });

    vi.mocked(prisma.resumeAnalysis.findFirst).mockResolvedValueOnce({ id: "a5" } as never);
    expect(await fetchResumeAccess("a5")).toEqual({ kind: "visible", analysis: { id: "a5" } });

    vi.mocked(prisma.resumeAnalysis.findFirst).mockResolvedValueOnce(null);
    expect(await fetchResumeAccess("a9")).toEqual({ kind: "missing" });

    vi.mocked(prisma.resumeAnalysis.findFirst).mockResolvedValueOnce({ id: "a1" } as never);
    expect(await fetchResumeById("a1")).toBeNull();
    // Ownership stays in the where clause.
    expect(prisma.resumeAnalysis.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a1", userId: "user_1" } }));
  });

  it("fetchInterviewById answers null for the interview of a hidden analysis, and the row for a visible one", async () => {
    vi.mocked(prisma.interview.findFirst).mockResolvedValueOnce({ id: "i2", resumeAnalysisId: "a1" } as never);
    expect(await fetchInterviewById("i2")).toBeNull();

    vi.mocked(prisma.interview.findFirst).mockResolvedValueOnce({ id: "i1", resumeAnalysisId: "a5" } as never);
    expect(await fetchInterviewById("i1")).toMatchObject({ id: "i1" });
  });
});
