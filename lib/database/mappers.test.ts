import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_CATEGORIES } from "@/lib/ai/schemas";
import { mapDbInterviewFeedback, mapDbResume, type DbInterviewFeedback } from "./mappers";

const row = (report: unknown): DbInterviewFeedback => ({
  id: "feedback_1",
  interviewId: "interview_1",
  totalScore: 65,
  report: report as DbInterviewFeedback["report"],
  guardStats: null,
  createdAt: new Date("2026-10-11T10:20:00Z"),
  interview: { role: "Backend Engineer", createdAt: new Date("2026-10-11T10:00:00Z") },
});

const REPORT = {
  gapFollowThrough: [],
  notableAnswers: [{ quote: "I built it", worked: true, why: "Concrete." }],
  categoryScores: FEEDBACK_CATEGORIES.map((name) => ({ name, score: 65, comment: "ok" })),
  strengths: [{ point: "Concrete", anchor: { source: "notableAnswers", index: 0 } }],
  areasForImprovement: [],
  finalAssessment: "Fine.",
  totalScore: 65,
  interviewStats: {
    totalTurns: 2,
    candidateTurns: 1,
    candidateWords: 3,
    averageCandidateTurnWords: 3,
    candidateOnFloorSeconds: null,
    longestTurnGapSeconds: null,
    durationSeconds: null,
    short: true,
  },
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("mapDbInterviewFeedback", () => {
  it("returns the validated report with the interview's role and date", () => {
    const mapped = mapDbInterviewFeedback(row(REPORT));

    expect(mapped).toMatchObject({
      id: "feedback_1",
      role: "Backend Engineer",
      createdAt: "2026-10-11T10:00:00.000Z",
      totalScore: 65,
    });
    expect(mapped?.report.notableAnswers[0].quote).toBe("I built it");
  });

  it("reads a row written in the pre-M3-B shape as no feedback", () => {
    expect(mapDbInterviewFeedback(row(null))).toBeNull();
    expect(
      mapDbInterviewFeedback(
        row({
          categoryScores: REPORT.categoryScores,
          strengths: ["Clear"],
          areasForImprovement: ["Depth"],
          finalAssessment: "Fine.",
        }),
      ),
    ).toBeNull();
  });
});

describe("mapDbResume: rooms that never started", () => {
  const room = (id: string, attemptNumber: number, status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED", issuedConversationIds: string[] = []) => ({
    id,
    status,
    attemptNumber,
    failureReason: null,
    createdAt: new Date("2026-11-10T00:00:00Z"),
    startCount: issuedConversationIds.length,
    usageEventId: null,
    resumableUntil: null,
    issuedConversationIds,
    InterviewFeedback: status === "COMPLETED" ? { totalScore: 70 } : null,
  });
  const analysis = (interviews: ReturnType<typeof room>[]) =>
    ({
      id: "a1",
      companyName: "Northwind",
      jobTitle: "Data Analyst",
      jobDescription: "",
      resumeKey: "cv/user_1/a1.pdf",
      userId: "user_1",
      feedback: null,
      guardStats: null,
      createdAt: new Date("2026-11-01T00:00:00Z"),
      interviews,
    }) as unknown as Parameters<typeof mapDbResume>[0];

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("keeps a room never started out of the attempts, apart for the CTA, and numbers only what started", () => {
    const mapped = mapDbResume(analysis([room("i3", 3, "SCHEDULED"), room("i2", 2, "IN_PROGRESS", ["conv_2"]), room("i1", 1, "COMPLETED", ["conv_1"])]));
    expect(mapped.interviews.map((attempt) => [attempt.id, attempt.attemptNumber])).toEqual([
      ["i2", 2],
      ["i1", 1],
    ]);
    expect(mapped.unstartedRoom).toMatchObject({ id: "i3", status: "SCHEDULED", attemptNumber: 3 });
  });

  it("counts a room as started once a session was issued, even if its call failed and gave the start back", () => {
    const mapped = mapDbResume(analysis([{ ...room("i1", 1, "IN_PROGRESS", ["conv_1"]), startCount: 0 }]));
    expect(mapped.interviews.map((attempt) => attempt.id)).toEqual(["i1"]);
    expect(mapped.unstartedRoom).toBeNull();
  });
});
