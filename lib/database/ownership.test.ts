import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { fetchInterviewById, fetchInterviews } from "./interview";
import { fetchResumeById, fetchResumeKey, fetchResumes } from "./resume";

// Every plan sees every analysis and interview it owns; ownership, in each read's `where`, is the only gate.

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_a") }));
vi.mock("./interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn(async () => 0) }));
vi.mock("./mappers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mappers")>();
  return {
    ...actual,
    mapDbResume: (row: { id: string }) => ({ id: row.id }),
    mapDbInterviewListItem: (row: { id: string }) => ({ id: row.id }),
  };
});
vi.mock("@/lib/prisma", () => ({
  default: {
    resumeAnalysis: { findMany: vi.fn(), findFirst: vi.fn() },
    interview: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

type Where = { id?: string; userId?: string };

/** user_a owns a1..a5 and i1; user_b owns b1 and ib1. */
const ANALYSES = [
  ...["a5", "a4", "a3", "a2", "a1"].map((id) => ({ id, userId: "user_a", resumeKey: `cv/user_a/${id}.pdf` })),
  { id: "b1", userId: "user_b", resumeKey: "cv/user_b/b1.pdf" },
];
const INTERVIEWS = [
  { id: "i1", userId: "user_a" },
  { id: "ib1", userId: "user_b" },
];

/** Answers like the database: a row matches only when every field of the `where` does. */
const matches = (row: Record<string, unknown>, where: Where) => (where.id === undefined || row.id === where.id) && (where.userId === undefined || row.userId === where.userId);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_a");
  vi.mocked(prisma.resumeAnalysis.findFirst).mockImplementation((async ({ where }: { where: Where }) => ANALYSES.find((row) => matches(row, where)) ?? null) as never);
  vi.mocked(prisma.resumeAnalysis.findMany).mockImplementation((async ({ where }: { where: Where }) => ANALYSES.filter((row) => matches(row, where))) as never);
  vi.mocked(prisma.interview.findFirst).mockImplementation((async ({ where }: { where: Where }) => INTERVIEWS.find((row) => matches(row, where)) ?? null) as never);
  vi.mocked(prisma.interview.findMany).mockImplementation((async ({ where }: { where: Where }) => INTERVIEWS.filter((row) => matches(row, where))) as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("another user's ids read as missing", () => {
  it("fetchResumeById answers null for another user's analysis, with the session user in the where", async () => {
    expect(await fetchResumeById("b1")).toBeNull();
    expect(vi.mocked(prisma.resumeAnalysis.findFirst).mock.calls[0][0]).toMatchObject({ where: { id: "b1", userId: "user_a" } });
    expect(await fetchResumeById("a1")).toEqual({ id: "a1" });
    expect(await fetchResumeById("nope")).toBeNull();
  });

  it("fetchResumeKey answers null for another user's analysis", async () => {
    expect(await fetchResumeKey("b1")).toBeNull();
    expect(await fetchResumeKey("a2")).toBe("cv/user_a/a2.pdf");
  });

  it("fetchInterviewById answers null for another user's interview, started or not", async () => {
    expect(await fetchInterviewById("ib1")).toBeNull();
    expect(vi.mocked(prisma.interview.findFirst).mock.calls[0][0]).toMatchObject({ where: { id: "ib1", userId: "user_a" } });
    expect(await fetchInterviewById("i1")).toMatchObject({ id: "i1" });
  });

  it("the same id reads as the owner's for the owner", async () => {
    vi.mocked(requireUserId).mockResolvedValue("user_b");
    expect(await fetchResumeById("b1")).toEqual({ id: "b1" });
    expect(await fetchInterviewById("ib1")).toMatchObject({ id: "ib1" });
    expect(await fetchResumeById("a1")).toBeNull();
  });
});

describe("the whole history, on every plan", () => {
  it("fetchResumes lists every one of the caller's analyses, newest first, and nobody else's", async () => {
    expect((await fetchResumes()).map((row) => row.id)).toEqual(["a5", "a4", "a3", "a2", "a1"]);
    expect(prisma.resumeAnalysis.findMany).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.resumeAnalysis.findMany).mock.calls[0][0]).toMatchObject({ where: { userId: "user_a" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  });

  it("fetchInterviews lists the caller's started interviews and nobody else's", async () => {
    expect((await fetchInterviews()).map((row) => row.id)).toEqual(["i1"]);
    expect(vi.mocked(prisma.interview.findMany).mock.calls[0][0]).toMatchObject({
      where: { userId: "user_a", OR: [{ status: { not: "SCHEDULED" } }, { issuedConversationIds: { isEmpty: false } }] },
    });
  });
});
