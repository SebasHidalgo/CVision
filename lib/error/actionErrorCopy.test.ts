import { describe, expect, it } from "vitest";
import { tFor } from "@/lib/i18n/testing";
import type { ErrorCode, ErrorMeta } from "./errors";
import { actionErrorCopy as copyIn, resetDateCopy } from "./actionErrorCopy";

const en = tFor("errors", "en");
const es = tFor("errors", "es");
const actionErrorCopy = (code: ErrorCode, meta?: ErrorMeta) => copyIn(en, "en", code, meta);
const spanish = (code: ErrorCode, meta?: ErrorMeta) => copyIn(es, "es", code, meta);

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
    expect(resetDateCopy("2026-12-01T00:00:00.000Z", "en")).toBe("Dec 1");
    expect(resetDateCopy("2026-12-01T00:00:00.000Z", "es")).toBe("1 de diciembre");
  });
});

describe("actionErrorCopy for the provider's billing", () => {
  it("says the service is unavailable and nothing was charged", () => {
    expect(actionErrorCopy("AI_BILLING")).toBe("The analysis service is temporarily unavailable. Nothing was charged.");
  });
});

describe("actionErrorCopy for the file refusals", () => {
  // Every one of them gives the analysis back, and the copy says so.
  it.each(["PDF_UNREADABLE", "PDF_NO_TEXT", "PDF_SCANNED"] as const)("%s says no analysis was used", (code) => {
    expect(actionErrorCopy(code)).toMatch(/This didn't use any of your analyses\.$/);
  });
});

describe("actionErrorCopy in Spanish", () => {
  it("fills the same blanks, with dates formatted in Spanish", () => {
    expect(spanish("ANALYSIS_QUOTA_EXCEEDED", { plan: "FREE", resetsAt: "2026-11-01T00:00:00.000Z" })).toBe(
      "Ya usaste los análisis de este mes. Se reinician el 1 de noviembre.",
    );
    expect(spanish("RATE_LIMITED", { retryAfter: 1 })).toBe("Demasiadas solicitudes en poco tiempo. Inténtalo de nuevo en 1 segundo.");
    expect(spanish("RATE_LIMITED", { retryAfter: 1500 })).toBe("Demasiadas solicitudes en poco tiempo. Inténtalo de nuevo en 25 minutos.");
    expect(spanish("FILE_TOO_LARGE")).toMatch(/10 MB/);
  });

  it("falls back to the generic copy for a code this build does not know", () => {
    expect(spanish("SOMETHING_NEW" as ErrorCode)).toBe(spanish("UNKNOWN"));
    expect(actionErrorCopy("SOMETHING_NEW" as ErrorCode)).toBe("Something went wrong on our side. Please try again.");
  });
});
