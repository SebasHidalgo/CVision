import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { tFor } from "@/lib/i18n/testing";
import { decideEntitlement } from "@/lib/interviewEntitlement";
import type { InterviewAttempt } from "@/types/resume";
import InterviewAttempts from "./InterviewAttempts";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const attempts: InterviewAttempt[] = [
  { id: "i3", status: "IN_PROGRESS", attemptNumber: 3, failureReason: null, totalScore: null, createdAt: "2026-10-13T10:00:00.000Z", startCount: 0, held: false, resumableUntil: null },
  { id: "i2", status: "COMPLETED", attemptNumber: 2, failureReason: null, totalScore: 61, createdAt: "2026-10-12T10:00:00.000Z", startCount: 1, held: false, resumableUntil: null },
  { id: "i1", status: "FAILED", attemptNumber: 1, failureReason: null, totalScore: null, createdAt: "2026-10-11T10:00:00.000Z", startCount: 1, held: false, resumableUntil: null },
];

const periodEnd = new Date("2026-12-01T00:00:00.000Z");
const canStart = decideEntitlement({ plan: "FREE", periodUsed: 0, credits: 0, trialsUsed: 0, hadVoice: false, periodEnd });
const trialUsed = decideEntitlement({ plan: "FREE", periodUsed: 0, credits: 0, trialsUsed: 1, hadVoice: false, periodEnd });
const proUsed = decideEntitlement({ plan: "PRO", periodUsed: 4, credits: 0, trialsUsed: 0, hadVoice: true, periodEnd });

describe("InterviewAttempts", () => {
  it("lists every attempt in the order given, with its state and score, linking to where it stands", () => {
    const html = renderToStaticMarkup(<InterviewAttempts attempts={attempts} t={tFor("analysis")} locale="en" entitlement={canStart} />);

    expect(html.indexOf("Attempt 3")).toBeLessThan(html.indexOf("Attempt 2"));
    expect(html.indexOf("Attempt 2")).toBeLessThan(html.indexOf("Attempt 1"));
    expect(html).toContain('href="/interview/i3"');
    expect(html).toContain("Not finished");
    expect(html).toContain('href="/interview/i2/feedback"');
    expect(html).toContain("Scored 61");
    expect(html).toContain('href="/interview/i1/feedback"');
    expect(html).toContain("Didn&#x27;t complete");
  });

  it("says what a waiting attempt lacks when the plan cannot start it, as its room does", () => {
    expect(renderToStaticMarkup(<InterviewAttempts attempts={attempts} t={tFor("analysis")} locale="en" entitlement={trialUsed} />)).toContain("Needs Pro to start");
    expect(renderToStaticMarkup(<InterviewAttempts attempts={attempts} t={tFor("analysis")} locale="en" entitlement={proUsed} />)).toContain("No interviews left this period");
    // One that holds its unit can still start.
    const held = [{ ...attempts[0], startCount: 1, held: true }];
    expect(renderToStaticMarkup(<InterviewAttempts attempts={held} t={tFor("analysis")} locale="en" entitlement={trialUsed} />)).toContain("Not finished");
  });

  it("renders nothing for an analysis with no attempts", () => {
    expect(renderToStaticMarkup(<InterviewAttempts attempts={[]} t={tFor("analysis")} locale="en" entitlement={canStart} />)).toBe("");
  });
});
