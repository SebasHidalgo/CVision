import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { PLANS } from "@/lib/plans";
import { resolvePlanStanding } from "./billing";
import { fetchHiddenInterviews, fetchVisibleInterviews, fetchInterviewById } from "./interview";
import { fetchResumeAccess, fetchResumeById, fetchVisibleResumes } from "./resume";
import { hiddenInterviewRows, isVisible, visibleAnalysisIds } from "./visibility";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("./billing", () => ({ resolvePlanStanding: vi.fn() }));
vi.mock("./interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn(async () => 0) }));
vi.mock("./mappers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mappers")>();
  return {
    ...actual,
    mapDbResume: (row: { id: string }) => ({ id: row.id }),
    mapDbInterviewListItem: (row: { id: string; resumeAnalysisId: string | null }) => ({ id: row.id, analysisId: row.resumeAnalysisId }),
  };
});
vi.mock("@/lib/prisma", () => ({
  default: {
    resumeAnalysis: { findMany: vi.fn(), findFirst: vi.fn() },
    interview: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

type FindArgs = { take?: number; skip?: number; where?: { userId?: string; id?: { in: string[] }; resumeAnalysisId?: { in: string[] } } };

const standing = (plan: "FREE" | "PRO") => ({ plan, source: "free", subscription: null, everSubscribed: false }) as never;
const analysis = (id: string, interviews = 0) => ({ id, jobTitle: `Role ${id}`, companyName: `Company ${id}`, createdAt: new Date(0), _count: { interviews } });

/** Answers like the database would: newest first, take/skip applied, an id filter honoured. */
function analysesAre(rows: ReturnType<typeof analysis>[]) {
  vi.mocked(prisma.resumeAnalysis.findMany).mockImplementation((async (args: FindArgs) => {
    if (args?.where?.id) return rows.filter((row) => args.where?.id?.in.includes(row.id));
    if (args?.take !== undefined) return rows.slice(0, args.take);
    if (args?.skip !== undefined) return rows.slice(args.skip);
    return rows;
  }) as never);
}

/** Five analyses, newest first. */
const ALL = ["a5", "a4", "a3", "a2", "a1"].map((id) => analysis(id));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolvePlanStanding).mockResolvedValue(standing("FREE"));
  analysesAre(ALL);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("visibleAnalysisIds", () => {
  it("is the Free account's three most recent, and everything for Pro", async () => {
    expect(await visibleAnalysisIds("user_1")).toEqual(new Set(["a5", "a4", "a3"]));
    expect(prisma.resumeAnalysis.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

  it("fetchVisibleInterviews hides the interviews of hidden analyses as summaries, keeps detached ones", async () => {
    vi.mocked(prisma.interview.findMany).mockResolvedValue([
      { id: "i1", role: "Role a5", createdAt: new Date(Date.UTC(2026, 10, 3)), resumeAnalysisId: "a5", resumeAnalysis: { companyName: "Company a5" } },
      { id: "i2", role: "Role a1", createdAt: new Date(Date.UTC(2026, 10, 2)), resumeAnalysisId: "a1", resumeAnalysis: { companyName: "Company a1" } },
      { id: "i3", role: "Old", createdAt: new Date(Date.UTC(2026, 10, 1)), resumeAnalysisId: null, resumeAnalysis: null },
    ] as never);

    const { interviews, hidden } = await fetchVisibleInterviews();
    expect(interviews.map((i) => i.id)).toEqual(["i1", "i3"]);
    expect(hidden).toEqual([{ id: "i2", role: "Role a1", companyName: "Company a1", createdAt: "2026-11-02T00:00:00.000Z" }]);
  });
});

describe("Pro to Free with three interviews, one per analysis (the owner's finding)", () => {
  // Four analyses, newest first; interviews on the newest, the third and the oldest. Free shows a4, a3, a2.
  const FOUR = [analysis("a4", 1), analysis("a3"), analysis("a2", 1), analysis("a1", 1)];
  const at = (day: number) => new Date(Date.UTC(2026, 10, day));
  const INTERVIEWS = [
    { id: "i4", role: "Role a4", createdAt: at(4), resumeAnalysisId: "a4", resumeAnalysis: { companyName: "Company a4" } },
    { id: "i2", role: "Role a2", createdAt: at(2), resumeAnalysisId: "a2", resumeAnalysis: { companyName: "Company a2" } },
    { id: "i1", role: "Role a1", createdAt: at(1), resumeAnalysisId: "a1", resumeAnalysis: { companyName: "Company a1" } },
  ];

  beforeEach(() => {
    analysesAre(FOUR);
    vi.mocked(prisma.interview.findMany).mockImplementation((async (args: FindArgs) =>
      args?.where?.resumeAnalysisId ? INTERVIEWS.filter((row) => args.where?.resumeAnalysisId?.in.includes(row.resumeAnalysisId)) : INTERVIEWS) as never);
    vi.mocked(prisma.interview.findFirst).mockImplementation((async (args: { where: { id: string; userId: string } }) =>
      INTERVIEWS.find((row) => row.id === args.where.id && args.where.userId === "user_1") ?? null) as never);
  });

  it("Pro: all three interviews are listed and open, nothing is hidden", async () => {
    vi.mocked(resolvePlanStanding).mockResolvedValue(standing("PRO"));

    const { interviews, hidden } = await fetchVisibleInterviews();
    expect(interviews.map((i) => i.id)).toEqual(["i4", "i2", "i1"]);
    expect(hidden).toEqual([]);
    expect(await fetchHiddenInterviews()).toEqual([]);
    for (const id of ["i4", "i2", "i1"]) expect(await fetchInterviewById(id)).toMatchObject({ id });
  });

  it("Free: two are listed; the third is in the hidden block, its pages answer null, and it is what a delete may take", async () => {
    const { interviews, hidden } = await fetchVisibleInterviews();
    expect(interviews.map((i) => i.id)).toEqual(["i4", "i2"]);
    expect(hidden).toEqual([{ id: "i1", role: "Role a1", companyName: "Company a1", createdAt: "2026-11-01T00:00:00.000Z" }]);

    // The room and the feedback page read through this: the hidden one doesn't open, the visible ones do.
    expect(await fetchInterviewById("i1")).toBeNull();
    expect(await fetchInterviewById("i2")).toMatchObject({ id: "i2" });

    // The delete's re-read: the hidden analyses first, then their interviews, both scoped to the user.
    expect(await fetchHiddenInterviews()).toEqual(hidden);
    expect(prisma.resumeAnalysis.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: "user_1" }, skip: PLANS.FREE.historyLimit }));
    expect(prisma.interview.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { userId: "user_1", resumeAnalysisId: { in: ["a1"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    );

    // The hidden analysis says how many interviews deleting it takes along.
    const resumes = await fetchVisibleResumes();
    expect(resumes.hiddenAnalyses).toEqual([expect.objectContaining({ id: "a1", interviews: 1 })]);
  });

  it("hiddenInterviewRows reads no interviews when no analysis is hidden", async () => {
    analysesAre(FOUR.slice(0, 3));
    expect(await hiddenInterviewRows("user_1")).toEqual([]);
    expect(prisma.interview.findMany).not.toHaveBeenCalled();

    vi.mocked(resolvePlanStanding).mockResolvedValue(standing("PRO"));
    expect(await hiddenInterviewRows("user_1")).toEqual([]);
    expect(prisma.resumeAnalysis.findMany).toHaveBeenCalledTimes(1);
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
