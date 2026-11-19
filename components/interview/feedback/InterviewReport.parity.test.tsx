// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, useTranslation } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { interviewFeedbackReportSchema } from "@/lib/ai/schemas";
import { formatLongDate } from "@/lib/format";
import { LOCALES, type Locale, type Namespace } from "@/lib/i18n/config";
import { createI18n } from "@/lib/i18n/instance";
import { RESOURCES } from "@/lib/i18n/resources";
import { tFor } from "@/lib/i18n/testing";
import { useExampleCase } from "@/screens/Home/hooks/useExampleCase";
import { EXAMPLE_REPORT, exampleReportData } from "@/screens/Home/components/interview/exampleReport";
import { Report } from "@/screens/Home/components/interview/Report";
import { useTalkScript } from "@/screens/Home/components/interview/useTalkScript";
import FeedbackReport, { feedbackReportData } from "@/screens/InterviewFeedback/components/FeedbackReport";
import { InterviewReport, type InterviewReportData } from "./InterviewReport";

// The landing says its interview section shows the app's real screens: its report must be the page's report tree,
// fed with the example in the page's data shape, not a copy that drifts.

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const request = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("@/lib/i18n/server", async () => {
  const { tFor } = await import("@/lib/i18n/testing");
  return { getT: async (ns: Namespace) => tFor(ns, request.locale), getLocale: async () => request.locale };
});

const toDom = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

/** The landing's report as the section mounts it, and the shared tree fed with the same example data beside it. */
function Harness({ locale, onData }: { locale: Locale; onData: (data: InterviewReportData) => void }) {
  const example = useExampleCase();
  const script = useTalkScript(locale);
  const { t } = useTranslation("feedback");
  const { t: common } = useTranslation("common");
  const { t: tl } = useTranslation("landingInterview");
  const quoteOf = (line: number) => script.lines[line]?.text ?? "";
  const data = exampleReportData({ role: example.role, company: example.company, date: formatLongDate(EXAMPLE_REPORT.date, locale), requirements: example.requirements, script, quoteOf, t, tl });
  onData(data);
  return (
    <>
      <div id="landing">
        <Report script={script} role={example.role} requirements={example.requirements} quoteOf={quoteOf} locale={locale} />
      </div>
      <div id="shared">
        <InterviewReport {...data} t={t} common={common} embedded idPrefix="landing-feedback" transcriptNote={tl("example.sample", { total: EXAMPLE_REPORT.transcriptLines })} />
      </div>
    </>
  );
}

const signature = (root: Element) =>
  [...root.querySelectorAll("[data-feedback-part], [data-feedback-row], [data-transcript-line]")].map(
    (el) => el.getAttribute("data-feedback-part") ?? `${el.getAttribute("data-feedback-row") ?? "line"}`,
  );

describe.each(LOCALES)("%s: the landing's report and the feedback page's", (locale) => {
  it("render the same component tree for the same props", async () => {
    request.locale = locale;
    let data: InterviewReportData | null = null;
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={createI18n(locale, RESOURCES[locale])}>
        <Harness locale={locale} onData={(d) => (data = d)} />
      </I18nextProvider>,
    );
    const dom = toDom(html);
    const landing = dom.querySelector("#landing article");
    const shared = dom.querySelector("#shared article");
    expect(landing).not.toBeNull();
    // 1. The landing renders the shared tree, nothing of its own.
    expect(landing?.outerHTML).toBe(shared?.outerHTML);

    // 2. The page, fed the example as a stored report, renders the shared tree from data shaped exactly like the example's.
    const example = data as unknown as InterviewReportData;
    // The example is a report the app could have stored.
    expect(() => interviewFeedbackReportSchema.parse(example.report)).not.toThrow();
    const turns = (example.transcript?.entries ?? []).flatMap((entry) =>
      entry.kind === "line" ? [{ role: entry.who === "candidate" ? "user" : "agent", message: entry.text, time_in_call_secs: Number(entry.at?.split(":")[0]) * 60 + Number(entry.at?.split(":")[1]) }] : [],
    );
    const props = {
      feedback: { id: "f1", interviewId: "i1", role: example.role, createdAt: "2026-11-17T10:00:00.000Z", totalScore: example.totalScore, report: example.report },
      transcript: turns,
      date: example.date,
      company: example.company,
      attempt: example.attempt ?? 1,
      analysisId: "a1",
      rehearse: { canStart: true, parts: [{ key: "period" as const, count: 3, limit: 4 }] },
      locale,
    };
    const app = feedbackReportData(props, tFor("feedback", locale));
    const { next, allInterviewsHref, transcript, ...content } = app;
    const { next: exampleNext, allInterviewsHref: _href, transcript: exampleTranscript, ...exampleContent } = example;
    expect(content).toEqual(exampleContent);
    expect(next?.note).toBe(exampleNext?.note);
    const unkeyed = (entries: NonNullable<InterviewReportData["transcript"]>["entries"] = []) => entries.map((entry) => ({ ...entry, key: 0 }));
    expect(unkeyed(transcript?.entries)).toEqual(unkeyed(exampleTranscript?.entries));

    const page = toDom(renderToStaticMarkup(await FeedbackReport(props)));
    const pageAsLanding = toDom(
      renderToStaticMarkup(<InterviewReport {...example} next={next} allInterviewsHref={allInterviewsHref} transcript={transcript} t={tFor("feedback", locale)} common={tFor("common", locale)} />),
    );
    expect(page.innerHTML).toBe(pageAsLanding.innerHTML);

    // 3. Same parts, same rows, in the same order; only the heading levels and the links differ.
    expect(signature(landing as Element)).toEqual(signature(page));
    expect(page.querySelector("h1")?.textContent).toBe(landing?.querySelector("h3")?.textContent);
  });
});
