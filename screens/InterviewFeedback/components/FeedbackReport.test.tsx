// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InterviewReport } from "@/components/interview/feedback/InterviewReport";
import { REPORT } from "@/components/interview/feedback/report.stub";
import { PENDING_PROSE } from "@/lib/i18n/analysisView";
import type { Locale, Namespace } from "@/lib/i18n/config";
import { tFor } from "@/lib/i18n/testing";
import type { InterviewFeedback } from "@/types/interview";
import FeedbackReport, { feedbackReportData } from "./FeedbackReport";

// Link needs the app router at runtime; a plain anchor is enough to render.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// A server component: its t comes from the request, here the real resources of the chosen locale.
const request = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("@/lib/i18n/server", async () => {
  const { tFor } = await import("@/lib/i18n/testing");
  return { getT: async (ns: Namespace) => tFor(ns, request.locale), getLocale: async () => request.locale };
});

afterEach(() => {
  request.locale = "en";
});

const feedback: InterviewFeedback = {
  id: "feedback_1",
  interviewId: "interview_1",
  role: "Backend Engineer",
  createdAt: "2026-10-11T10:00:00.000Z",
  totalScore: 71,
  report: REPORT,
};

const props = {
  feedback,
  transcript: [
    { role: "agent", message: "Tell me about the Kubernetes migration.", time_in_call_secs: 12 },
    { role: "user", message: "Last year we moved the six orders services to a managed Kubernetes cluster.", time_in_call_secs: 15 },
  ],
  date: "October 11, 2026",
  company: "Northwind",
  attempt: 2,
  analysisId: "analysis_1",
  rehearse: { canStart: true, parts: [{ key: "period" as const, count: 3, limit: 4 }, { key: "credits" as const, count: 2 }] },
  locale: "en" as Locale,
};

const text = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root.textContent ?? "";
};

describe("FeedbackReport (the page's report)", () => {
  it("is the shared report tree, fed from the stored feedback", async () => {
    const page = renderToStaticMarkup(await FeedbackReport(props));
    const shared = renderToStaticMarkup(<InterviewReport {...feedbackReportData(props, tFor("feedback"))} t={tFor("feedback")} common={tFor("common")} />);
    expect(page).toBe(shared);
  });

  it("shows a skeleton where the model's prose waits for its translation", async () => {
    const pending = { ...props, feedback: { ...feedback, report: { ...REPORT, finalAssessment: PENDING_PROSE } } };
    const html = renderToStaticMarkup(await FeedbackReport(pending));
    expect(html).toContain("data-prose-pending");
    expect(html).not.toContain(PENDING_PROSE);
  });

  it("closes on the analysis with what the plan has left for the next attempt", async () => {
    const data = feedbackReportData(props, tFor("feedback"));
    expect(data.next).toEqual({ href: "/resume/analysis/analysis_1#interview-cta-title", action: "again", note: "3 of 4 interviews left this period · 2 credits" });
    expect(data.allInterviewsHref).toBe("/interviews");
    expect(text(renderToStaticMarkup(await FeedbackReport(props)))).toContain("3 of 4 interviews left this period · 2 credits");
  });

  it("says why when nothing is left, and offers the analysis instead of a rehearsal", () => {
    const data = feedbackReportData({ ...props, rehearse: { canStart: false, parts: [{ key: "periodUsed", resetsAt: "2026-12-01T00:00:00.000Z" }] } }, tFor("feedback"));
    expect(data.next).toMatchObject({ action: "analysis", note: "This period's interviews are used. They come back December 1, 2026." });
  });

  it("has nowhere to rehearse from once the analysis is gone", () => {
    expect(feedbackReportData({ ...props, analysisId: null }, tFor("feedback")).next).toBeNull();
  });

  it("dates the reset in the reader's language", async () => {
    request.locale = "es";
    const data = feedbackReportData(
      { ...props, locale: "es", rehearse: { canStart: false, parts: [{ key: "periodUsed", resetsAt: "2026-12-01T00:00:00.000Z" }] } },
      tFor("feedback", "es"),
    );
    expect(data.next?.note).toBe("Ya usaste las entrevistas de este período. Vuelven el 1 de diciembre de 2026.");
  });
});
