import { describe, expect, it } from "vitest";
import { MAX_INTERVIEW_DURATION_SECONDS, MAX_INTERVIEW_STARTS } from "./interviewLimits";

describe("interview limits", () => {
  it("are the full agent's hard cap and the start cap; quotas live in lib/plans.ts", () => {
    expect(MAX_INTERVIEW_DURATION_SECONDS).toBe(12 * 60);
    expect(MAX_INTERVIEW_STARTS).toBe(3);
  });
});
