import { describe, expect, it } from "vitest";
import { formatResetDate, INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS, quotaPeriod, RATE_LIMITS } from "./plans";

describe("the plans", () => {
  it("are the owner's numbers", () => {
    expect(PLANS.FREE).toEqual({
      analysesPerMonth: 3,
      announceAnalyses: true,
      interviewsPerMonth: 0,
      trialInterviews: 1,
      historyLimit: 3,
    });
    expect(PLANS.PRO).toEqual({
      analysesPerMonth: 50,
      announceAnalyses: false,
      interviewsPerMonth: 4,
      trialInterviews: 0,
      historyLimit: null,
    });
    expect(INTERVIEW_TIERS.TRIAL.seconds).toBe(300);
    expect(INTERVIEW_TIERS.FULL.seconds).toBe(720);
  });

  it("rate limits are hourly, except the status ceiling, which is per minute", () => {
    expect(RATE_LIMITS.analysis).toEqual({ limit: 10, windowMs: 3_600_000 });
    expect(RATE_LIMITS.uploadUrl).toEqual({ limit: 20, windowMs: 3_600_000 });
    expect(RATE_LIMITS.interviewStart).toEqual({ limit: 6, windowMs: 3_600_000 });
    expect(RATE_LIMITS.interviewCreate).toEqual({ limit: 3, windowMs: 3_600_000 });
    // Two tabs polling every 3 s make 40 a minute; the ceiling is above that.
    expect(RATE_LIMITS.status).toEqual({ limit: 60, windowMs: 60_000 });
    expect(RATE_LIMITS.reconcile).toEqual({ limit: 6, windowMs: 3_600_000 });
    expect(INTERVIEW_PACK_CREDITS).toBe(4);
  });
});

describe("quotaPeriod", () => {
  it("is the calendar month in UTC, whatever the local clock says", () => {
    expect(quotaPeriod(new Date("2026-10-16T23:59:59Z"))).toEqual({
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-11-01T00:00:00Z"),
    });
    // The last instant of a month in UTC belongs to that month; the first of the next is a new period.
    expect(quotaPeriod(new Date("2026-10-31T23:59:59.999Z")).end).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(quotaPeriod(new Date("2026-11-01T00:00:00Z")).start).toEqual(new Date("2026-11-01T00:00:00Z"));
    // December rolls into the next year.
    expect(quotaPeriod(new Date("2026-12-15T12:00:00Z")).end).toEqual(new Date("2027-01-01T00:00:00Z"));
  });

  it("formats the reset day in UTC", () => {
    expect(formatResetDate(quotaPeriod(new Date("2026-10-16T12:00:00Z")).end)).toBe("Nov 1");
    expect(formatResetDate(new Date("2027-01-01T00:00:00Z"))).toBe("Jan 1");
  });
});
