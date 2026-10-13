import { describe, expect, it } from "vitest";
import {
  computeTotalScore,
  FEEDBACK_CATEGORIES,
  feedbackSchema,
  interviewFeedbackReportSchema,
} from "./schemas";

function categoryScores(scores: number[] = [60, 65, 70, 75, 80]) {
  return FEEDBACK_CATEGORIES.map((name, i) => ({
    name,
    score: scores[i],
    comment: `About ${name}`,
  }));
}

function feedback(overrides: Record<string, unknown> = {}) {
  return {
    gapFollowThrough: [
      { requirement: "GraphQL", outcome: "dodged", quote: "I have seen it around", note: "Stayed general." },
    ],
    notableAnswers: [
      { quote: "I led the migration and cut the build to ten minutes", worked: true, why: "Own part and a result." },
      { quote: "I would probably look into it", worked: false, why: "No commitment." },
    ],
    categoryScores: categoryScores(),
    strengths: [{ point: "Owns results", anchor: { source: "notableAnswers", index: 0 } }],
    areasForImprovement: [{ point: "Answer the GraphQL question with an example", anchor: { source: "gapFollowThrough", index: 0 } }],
    finalAssessment: "A solid interview.",
    ...overrides,
  };
}

const accepts = (value: unknown) => feedbackSchema.safeParse(value).success;

describe("feedbackSchema: exactly five distinct categories", () => {
  it("accepts the five categories, once each", () => {
    expect(accepts(feedback())).toBe(true);
  });

  it("accepts them in any order", () => {
    expect(accepts(feedback({ categoryScores: categoryScores().reverse() }))).toBe(true);
  });

  it("rejects four categories", () => {
    expect(accepts(feedback({ categoryScores: categoryScores().slice(0, 4) }))).toBe(false);
  });

  it("rejects a sixth entry, even when it repeats a category", () => {
    const five = categoryScores();
    expect(accepts(feedback({ categoryScores: [...five, five[0]] }))).toBe(false);
  });

  it("rejects five entries with one category repeated", () => {
    const five = categoryScores();
    expect(accepts(feedback({ categoryScores: [...five.slice(0, 4), five[0]] }))).toBe(false);
  });

  it("rejects a category name outside the list", () => {
    const five = categoryScores();
    five[4] = { ...five[4], name: "Leadership" as (typeof five)[number]["name"] };
    expect(accepts(feedback({ categoryScores: five }))).toBe(false);
  });
});

describe("feedbackSchema: whole-number scores from 0 to 100", () => {
  const withScore = (score: unknown) => {
    const five: Array<Record<string, unknown>> = categoryScores();
    five[0] = { ...five[0], score };
    return feedback({ categoryScores: five });
  };

  it.each([0, 100])("accepts %s", (score) => {
    expect(accepts(withScore(score))).toBe(true);
  });

  it.each([-1, 101, 72.5])("rejects %s", (score) => {
    expect(accepts(withScore(score))).toBe(false);
  });

  // Same tolerance as the resume analysis scores: a quoted number is a number.
  it("accepts a numeric string and reads it as the number", () => {
    const result = feedbackSchema.safeParse(withScore("80"));
    expect(result.success).toBe(true);
    expect(result.data?.categoryScores[0].score).toBe(80);
  });

  it("rejects a numeric string outside 0-100 or not whole", () => {
    expect(accepts(withScore("101"))).toBe(false);
    expect(accepts(withScore("72.5"))).toBe(false);
  });

  // Nested so it.each does not spread `[]` into zero arguments.
  it.each([[null], [""], ["  "], [false], [true], [[]], [{}], ["abc"]])(
    "rejects %j instead of reading it as a number",
    (score) => {
      expect(accepts(withScore(score))).toBe(false);
    },
  );
});

describe("feedbackSchema: the M3-B shape", () => {
  it("reads a capitalized outcome as the enum value, and rejects one outside it", () => {
    const row = { requirement: "GraphQL", outcome: "Addressed", quote: "", note: "" };
    const parsed = feedbackSchema.safeParse(feedback({ gapFollowThrough: [row] }));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.gapFollowThrough[0].outcome).toBe("addressed");

    expect(accepts(feedback({ gapFollowThrough: [{ ...row, outcome: "skipped" }] }))).toBe(false);
  });

  it("requires every strength and area to carry an anchor", () => {
    expect(accepts(feedback({ strengths: ["Clear structure"] }))).toBe(false);
    expect(accepts(feedback({ strengths: [{ point: "Clear", anchor: { source: "transcript", index: 0 } }] }))).toBe(false);
    expect(accepts(feedback({ strengths: [{ point: "Clear", anchor: { source: "notableAnswers", index: -1 } }] }))).toBe(false);
  });

  it("rejects the pre-M3-B shape: plain string strengths, no gap rows", () => {
    expect(
      accepts({
        categoryScores: categoryScores(),
        strengths: ["Clear structure"],
        areasForImprovement: ["More technical depth"],
        finalAssessment: "A solid interview.",
      }),
    ).toBe(false);
  });
});

describe("interviewFeedbackReportSchema: what is persisted", () => {
  const stats = {
    totalTurns: 8,
    candidateTurns: 4,
    candidateWords: 220,
    averageCandidateTurnWords: 55,
    candidateOnFloorSeconds: 310.5,
    longestTurnGapSeconds: 42,
    durationSeconds: 400,
    short: false,
  };

  it("accepts the model answer plus the computed total and stats", () => {
    expect(
      interviewFeedbackReportSchema.safeParse({ ...feedback(), totalScore: 70, interviewStats: stats }).success,
    ).toBe(true);
  });

  it("accepts null timings for a transcript without offsets", () => {
    const untimed = { ...stats, candidateOnFloorSeconds: null, longestTurnGapSeconds: null, durationSeconds: null };
    expect(
      interviewFeedbackReportSchema.safeParse({ ...feedback(), totalScore: 70, interviewStats: untimed }).success,
    ).toBe(true);
  });

  it("rejects a report without stats or total", () => {
    expect(interviewFeedbackReportSchema.safeParse(feedback()).success).toBe(false);
  });
});

describe("computeTotalScore", () => {
  it("is the mean of the category scores, rounded", () => {
    expect(computeTotalScore(categoryScores([60, 65, 70, 75, 80]))).toBe(70);
    expect(computeTotalScore(categoryScores([80, 75, 70, 90, 72]))).toBe(77); // 77.4
    expect(computeTotalScore(categoryScores([80, 75, 70, 90, 73]))).toBe(78); // 77.6
  });
});
