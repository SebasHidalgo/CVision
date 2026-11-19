import { describe, expect, it } from "vitest";
import { FEEDBACK_CATEGORIES } from "@/lib/ai/schemas";
import { tFor } from "@/lib/i18n/testing";
import { CATEGORY_IDS, categoryId, categoryKey, categoryName, describeStats, plannedMinutes } from "./report";

describe("the five categories", () => {
  it("map each stored value to its id, in the stored order, and back", () => {
    expect(FEEDBACK_CATEGORIES.map(categoryId)).toEqual([...CATEGORY_IDS]);
    expect(CATEGORY_IDS.map(categoryName)).toEqual([...FEEDBACK_CATEGORIES]);
  });

  it("each has a label in both languages", () => {
    for (const locale of ["en", "es"] as const) {
      const t = tFor("feedback", locale);
      for (const name of FEEDBACK_CATEGORIES) expect(t(categoryKey(name))).not.toBe(categoryKey(name));
    }
  });
});

describe("the stats line", () => {
  const stats = { totalTurns: 12, candidateTurns: 1, candidateWords: 54, averageCandidateTurnWords: 53.6, candidateOnFloorSeconds: 20, longestTurnGapSeconds: 9, durationSeconds: 90, short: true };

  it("counts answers and words, and rounds the time on the floor up to a minute", () => {
    expect(describeStats(stats, tFor("feedback"))).toBe("1 answer · 54 words each · about 1 min on the floor");
  });

  it("leaves the time out when the turns carry none", () => {
    expect(describeStats({ ...stats, candidateOnFloorSeconds: null }, tFor("feedback"))).toBe("1 answer · 54 words each");
  });

  it("measures short against the booked length, a full interview when the report predates the trial", () => {
    expect(plannedMinutes(stats)).toBe(12);
    expect(plannedMinutes({ ...stats, plannedSeconds: 300 })).toBe(5);
  });
});
