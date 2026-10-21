import { describe, expect, it } from "vitest";
import { actionErrorCopy, resetDateCopy } from "./actionErrorCopy";

describe("actionErrorCopy for the limits", () => {
  it("names the Free allowance and its reset, and Pro's fair-use cap without a number", () => {
    expect(actionErrorCopy("ANALYSIS_QUOTA_EXCEEDED", { plan: "FREE", resetsAt: "2026-11-01T00:00:00.000Z" })).toBe(
      "You've used this month's analyses. Resets Nov 1.",
    );
    const pro = actionErrorCopy("ANALYSIS_QUOTA_EXCEEDED", { plan: "PRO", resetsAt: "2026-11-01T00:00:00.000Z" });
    expect(pro).toBe("You've reached this month's fair-use limit. Resets Nov 1.");
    expect(pro).not.toMatch(/50/);
  });

  it("sends a Free account to Pro for interviews, and tells a Pro account when its interviews return", () => {
    expect(actionErrorCopy("INTERVIEW_QUOTA_EXCEEDED", { plan: "FREE" })).toBe("Voice interviews are part of Pro.");
    expect(actionErrorCopy("INTERVIEW_QUOTA_EXCEEDED")).toBe("Voice interviews are part of Pro.");
    expect(actionErrorCopy("INTERVIEW_QUOTA_EXCEEDED", { plan: "PRO", resetsAt: "2026-11-01T00:00:00.000Z" })).toBe(
      "You've used this period's interviews. They reset Nov 1.",
    );
  });

  it("says how long a rate-limited request has to wait", () => {
    expect(actionErrorCopy("RATE_LIMITED", { retryAfter: 42 })).toBe("Too many requests in a short time. Try again in 42 seconds.");
    expect(actionErrorCopy("RATE_LIMITED", { retryAfter: 75 })).toBe("Too many requests in a short time. Try again in a minute.");
    expect(actionErrorCopy("RATE_LIMITED", { retryAfter: 1500 })).toBe("Too many requests in a short time. Try again in 25 minutes.");
    expect(actionErrorCopy("RATE_LIMITED")).toBe("Too many requests in a short time. Wait a moment and try again.");
  });

  it("formats reset dates in UTC", () => {
    expect(resetDateCopy("2026-12-01T00:00:00.000Z")).toBe("Dec 1");
  });
});
