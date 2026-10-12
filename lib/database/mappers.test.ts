import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_CATEGORIES } from "@/lib/ai/schemas";
import { mapDbInterviewFeedback, type DbInterviewFeedback } from "./mappers";

const row = (report: unknown): DbInterviewFeedback => ({
  id: "feedback_1",
  interviewId: "interview_1",
  totalScore: 65,
  report: report as DbInterviewFeedback["report"],
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
    candidateFloorSeconds: null,
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
