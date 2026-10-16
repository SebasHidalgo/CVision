import { describe, expect, it } from "vitest";
import {
  countedAttempts,
  countsTowardCap,
  MAX_INTERVIEW_ATTEMPTS_PER_ANALYSIS,
  MAX_INTERVIEW_DURATION_SECONDS,
  MAX_INTERVIEW_STARTS,
} from "./interviewLimits";

describe("interview limits", () => {
  it("are the three the room and the analysis page show", () => {
    expect(MAX_INTERVIEW_DURATION_SECONDS).toBe(12 * 60);
    expect(MAX_INTERVIEW_STARTS).toBe(3);
    expect(MAX_INTERVIEW_ATTEMPTS_PER_ANALYSIS).toBe(3);
  });

  it("counts every state except FAILED and EXPIRED, the live one included", () => {
    expect(countsTowardCap("SCHEDULED")).toBe(true);
    expect(countsTowardCap("IN_PROGRESS")).toBe(true);
    expect(countsTowardCap("FEEDBACK_PENDING")).toBe(true);
    expect(countsTowardCap("GENERATING")).toBe(true);
    expect(countsTowardCap("COMPLETED")).toBe(true);
    expect(countsTowardCap("FAILED")).toBe(false);
    expect(countsTowardCap("EXPIRED")).toBe(false);
  });

  it("sizes the cap by counted attempts only", () => {
    expect(
      countedAttempts([
        { status: "COMPLETED" },
        { status: "FAILED" },
        { status: "IN_PROGRESS" },
        { status: "EXPIRED" },
      ]),
    ).toBe(2);
    expect(countedAttempts([])).toBe(0);
  });
});
