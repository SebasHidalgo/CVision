import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { fetchVisibleInterviews } from "./interview";

// The interviews list's read: newest first, the plan's history applied, and the time a resumable interview has left.

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("./interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn(async () => 0) }));
vi.mock("./visibility", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./visibility")>()),
  visibleAnalysisIds: vi.fn(async () => null),
}));
vi.mock("@/lib/prisma", () => ({ default: { interview: { findMany: vi.fn() } } }));

const NOW = new Date("2026-11-18T12:00:00.000Z");
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

const listRow = (overrides: Record<string, unknown> = {}) => ({
  id: "i1",
  role: "Backend Engineer",
  status: "COMPLETED",
  createdAt: inMinutes(-60),
  resumeAnalysisId: "a1",
  attemptNumber: 1,
  conversationId: "c1",
  transcriptSource: "elevenlabs",
  startCount: 1,
  startedAt: inMinutes(-60),
  endedAt: inMinutes(-50),
  failureReason: null,
  usageEventId: "u1",
  resumableUntil: null,
  callEnd: { reason: "user", recorded: true },
  resumeAnalysis: { companyName: "Northwind" },
  InterviewFeedback: { totalScore: 74 },
  ...overrides,
});

const said = (seconds: number) => [
  { role: "agent", message: "Tell me about the migration.", time_in_call_secs: 1 },
  { role: "user", message: "We moved six services.", time_in_call_secs: seconds },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchVisibleInterviews", () => {
  it("reads newest first with the id breaking ties, never the transcripts, and maps each row for the list", async () => {
    vi.mocked(prisma.interview.findMany).mockResolvedValueOnce([listRow()] as never);
    const { interviews, hidden } = await fetchVisibleInterviews(NOW);

    const args = vi.mocked(prisma.interview.findMany).mock.calls[0][0] as { orderBy: unknown; select: Record<string, unknown>; where: unknown };
    expect(args.where).toEqual({ userId: "user_1" });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.select.transcript).toBeUndefined();
    expect(args.select.segments).toBeUndefined();
    expect(hidden).toEqual([]);
    expect(interviews).toEqual([
      expect.objectContaining({ id: "i1", companyName: "Northwind", analysisId: "a1", score: 74, held: true, hasTranscript: true, lastEnd: "user", secondsLeft: null }),
    ]);
    // Nothing resumable: the calls are never read.
    expect(prisma.interview.findMany).toHaveBeenCalledTimes(1);
  });

  it("gives a resumable interview the interview time it has left, read from its calls, owner-scoped", async () => {
    const resumable = { id: "i2", status: "IN_PROGRESS", resumableUntil: inMinutes(8), callEnd: { reason: "interviewer", recorded: true }, InterviewFeedback: null };
    vi.mocked(prisma.interview.findMany)
      .mockResolvedValueOnce([listRow(resumable), listRow()] as never)
      .mockResolvedValueOnce([
        {
          id: "i2",
          tier: "TRIAL",
          status: "IN_PROGRESS",
          startCount: 1,
          resumableUntil: inMinutes(8),
          segments: [],
          transcript: said(20),
          transcriptSource: "elevenlabs",
          durationSeconds: 16,
          lastSessionAt: inMinutes(-2),
          endedAt: inMinutes(-1),
        },
      ] as never);

    const { interviews } = await fetchVisibleInterviews(NOW);
    expect(vi.mocked(prisma.interview.findMany).mock.calls[1][0]).toMatchObject({ where: { id: { in: ["i2"] }, userId: "user_1" } });
    // A five-minute trial that used 16 seconds.
    expect(interviews.map((row) => [row.id, row.secondsLeft, row.lastEnd])).toEqual([
      ["i2", 284, "interviewer"],
      ["i1", null, "user"],
    ]);
  });

  it("gives no time left when there is nothing to resume (no starts left)", async () => {
    vi.mocked(prisma.interview.findMany)
      .mockResolvedValueOnce([listRow({ id: "i3", status: "IN_PROGRESS", resumableUntil: inMinutes(8), startCount: 3 })] as never)
      .mockResolvedValueOnce([
        { id: "i3", tier: "FULL", status: "IN_PROGRESS", startCount: 3, resumableUntil: inMinutes(8), segments: [], transcript: said(20), transcriptSource: "elevenlabs", durationSeconds: 60, lastSessionAt: inMinutes(-2), endedAt: inMinutes(-1) },
      ] as never);
    const { interviews } = await fetchVisibleInterviews(NOW);
    expect(interviews[0].secondsLeft).toBeNull();
  });
});
