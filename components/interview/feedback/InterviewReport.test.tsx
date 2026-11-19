// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_CATEGORIES } from "@/lib/ai/schemas";
import Prose from "@/components/i18n/Prose";
import { PENDING_PROSE } from "@/lib/i18n/analysisView";
import type { Locale } from "@/lib/i18n/config";
import { tFor } from "@/lib/i18n/testing";
import { InterviewReport, type InterviewReportData } from "./InterviewReport";
import { DATA, REPORT } from "./report.stub";

// Link needs the app router at runtime; a plain anchor is enough to render.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The page's renderer: a skeleton while the translation is on its way.
const skeletons = (text: string, lines?: number) => <Prose text={text} lines={lines} />;

const render = (data: InterviewReportData = DATA, options: { embedded?: boolean; locale?: Locale } = {}) => {
  const html = renderToStaticMarkup(
    <InterviewReport {...data} t={tFor("feedback", options.locale)} common={tFor("common", options.locale)} embedded={options.embedded} prose={skeletons} />,
  );
  const root = document.createElement("div");
  root.innerHTML = html;
  return { html, root, text: root.textContent ?? "" };
};

const parts = (root: HTMLElement) => [...root.querySelectorAll("[data-feedback-part]")].map((el) => el.getAttribute("data-feedback-part"));

describe("InterviewReport", () => {
  it("leads with the gap follow-through, then the answers, the readings, the points, the assessment, the transcript, what's next", () => {
    const { root } = render();
    expect(parts(root)).toEqual(["header", "gaps", "answers", "readings", "points", "final", "transcript", "next"]);
  });

  it("heads the page with the role, its company and attempt, the stats, and the total in its word", () => {
    const { root, text } = render();
    expect(root.querySelector("h1")?.textContent).toBe("Backend Engineer");
    expect(text).toContain("Interview feedback · October 11, 2026");
    expect(text).toContain("Northwind · Attempt 2");
    expect(text).toContain("6 answers · 70 words each · about 5 min on the floor");
    expect(text).toContain("Convincing");
    const overall = root.querySelector('[role="meter"][aria-label="Overall performance"]');
    expect(overall?.getAttribute("aria-valuenow")).toBe("71");
    expect(root.querySelector('a[href="/interviews"]')?.textContent).toContain("All interviews");
    // Not short: no notice.
    expect(root.querySelector("[data-feedback-short]")).toBeNull();
  });

  it("says when the interview was short for its planned length", () => {
    const short = { ...DATA, report: { ...REPORT, interviewStats: { ...REPORT.interviewStats, short: true, plannedSeconds: 300 } } };
    expect(render(short).root.querySelector("[data-feedback-short]")?.textContent).toBe(
      "Short for a 5-minute interview, so read these scores as low-confidence.",
    );
  });

  it("gives every gap its outcome by shape and word, and the candidate's words only where there are some", () => {
    const { root } = render();
    const rows = [...root.querySelectorAll('[data-feedback-row="gap"]')];
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["addressed", "dodged", "not_raised", "partially"]);
    expect(rows.map((row) => row.querySelector("[data-mark]")?.getAttribute("data-mark"))).toEqual(["full", "empty", "dashed", "half"]);
    expect(rows.map((row) => row.querySelector(".ed-cap")?.textContent)).toEqual(["Addressed", "Dodged", "Not raised", "Partly addressed"]);
    expect(rows[0].querySelector("blockquote")?.textContent).toBe("“Last year we moved the six orders services to a managed Kubernetes cluster.”");
    expect(rows[0].querySelector("blockquote")?.getAttribute("translate")).toBe("no");
    expect(rows[1].querySelector("blockquote")).toBeNull();
  });

  it("says so when the analysis found nothing to probe", () => {
    const { root } = render({ ...DATA, report: { ...REPORT, gapFollowThrough: [] } });
    expect(root.querySelector('[data-feedback-part="gaps"] h2')?.textContent).toBe("The analysis found no gaps to probe.");
    expect(root.querySelector('[data-feedback-row="gap"]')).toBeNull();
  });

  it("shows notable answers with their verdict, and hides one whose quote the guardrail dropped (and the section with none)", () => {
    const answers = [...render().root.querySelectorAll('[data-feedback-row="answer"]')];
    expect(answers.map((a) => a.querySelector(".ed-cap")?.textContent)).toEqual(["Worked", "Didn't land"]);

    const dropped = render({ ...DATA, report: { ...REPORT, notableAnswers: [{ quote: " ", worked: true, why: "Clear ownership." }] } });
    expect(dropped.text).not.toContain("Clear ownership.");
    expect(dropped.root.querySelector('[data-feedback-part="answers"]')).toBeNull();
    expect(dropped.html).not.toContain("“”");
  });

  it("reads the five categories in one fixed order, each with its meter and word on the 50/70 scale", () => {
    const { root } = render();
    const rows = [...root.querySelectorAll('[data-feedback-row="reading"]')];
    expect(rows.map((row) => row.querySelector("h3")?.textContent)).toEqual([...FEEDBACK_CATEGORIES]);
    // Confidence and Clarity was stored first: 55, "Fair".
    const last = rows[4];
    expect(last.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("55");
    expect(last.textContent).toContain("Fair");
    expect(rows[0].textContent).toContain("About Communication Skills.");
  });

  it("rests each point on the candidate's words, names the gap when the row has no quote, and tolerates a dangling anchor", () => {
    const { root } = render();
    const worked = root.querySelector('[data-feedback-row="worked"]');
    expect(worked?.querySelector("blockquote")?.textContent).toContain("I rolled back the deploy first");
    const [graphql, dangling] = [...root.querySelectorAll('[data-feedback-row="workOn"]')];
    expect(graphql.querySelector("blockquote")).toBeNull();
    expect(graphql.textContent).toContain("About the gap: GraphQL API design");
    expect(dangling.textContent).toBe("Dangling anchor is tolerated");
  });

  it("folds the transcript: who, when, the resumed call's marker, and no line for a turn with no words", () => {
    const { root } = render();
    const fold = root.querySelector('details[data-feedback-part="transcript"]');
    expect(fold?.hasAttribute("open")).toBe(false);
    expect(fold?.querySelector("summary")?.textContent).toContain("3 lines");
    const lines = [...(fold?.querySelectorAll("[data-transcript-line]") ?? [])];
    expect(lines.map((line) => line.getAttribute("data-transcript-line"))).toEqual(["interviewer", "candidate", "interviewer"]);
    expect(lines[1].textContent).toContain("You");
    expect(lines[1].textContent).toContain("0:15");
    expect(fold?.querySelector("[data-transcript-marker]")?.textContent).toBe("Call resumed");
    expect(fold?.textContent).not.toContain("...");
  });

  it("leaves the transcript out when the row has none", () => {
    expect(render({ ...DATA, transcript: null }).root.querySelector('[data-feedback-part="transcript"]')).toBeNull();
  });

  it("closes on the next rehearsal with what the plan has left, or on the analysis when nothing is", () => {
    const next = render().root.querySelector('[data-feedback-part="next"]');
    expect(next?.querySelector("a")?.getAttribute("href")).toBe("/resume/analysis/a1#interview-cta-title");
    expect(next?.textContent).toContain("Rehearse again");
    expect(next?.textContent).toContain("3 of 4 interviews left this period");

    const none = render({ ...DATA, next: { href: "/resume/analysis/a1#interview-cta-title", action: "analysis", note: "Voice interviews are part of Pro." } });
    expect(none.root.querySelector('[data-feedback-part="next"] a')?.textContent).toBe("Open the analysis");
    expect(render({ ...DATA, next: null }).root.querySelector('[data-feedback-part="next"]')).toBeNull();
  });

  it("shows skeletons only where the model's prose waits for its translation", () => {
    const pending = { ...REPORT, finalAssessment: PENDING_PROSE, gapFollowThrough: [{ ...REPORT.gapFollowThrough[0], note: PENDING_PROSE }] };
    const { root, text } = render({ ...DATA, report: pending });
    expect(root.querySelectorAll("[data-prose-pending]")).toHaveLength(2);
    expect(text).not.toContain(PENDING_PROSE);
    // Quotes and requirement names are never waiting.
    expect(text).toContain("Last year we moved the six orders services");
  });

  it("never puts anything but list items directly in a list, and keeps one h1 on the page", () => {
    const { root } = render();
    for (const list of root.querySelectorAll("ol, ul")) {
      for (const child of list.children) expect(child.tagName).toBe("LI");
    }
    expect(root.querySelectorAll("h1")).toHaveLength(1);
  });

  it("starts at h3 inside the landing's section, and with no links renders the words without them", () => {
    const { root } = render({ ...DATA, allInterviewsHref: null, next: { href: null, action: "again", note: null } }, { embedded: true });
    expect(root.querySelector("h1, h2")).toBeNull();
    expect(root.querySelector("h3")?.textContent).toBe("Backend Engineer");
    expect(root.querySelector('[data-feedback-part="gaps"] h4')).not.toBeNull();
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain("All interviews");
  });

  it("labels everything in Spanish and leaves the report's own words as stored", () => {
    const { root, text } = render(DATA, { locale: "es" });
    expect(text).toContain("Tus puntos débiles, en la entrevista");
    expect(text).toContain("Abordada");
    expect(text).toContain("6 respuestas · 70 palabras por respuesta · unos 5 min con la palabra");
    expect(text).toContain("Northwind · Intento 2");
    expect([...root.querySelectorAll('[data-feedback-row="reading"] h2, [data-feedback-row="reading"] h3')].map((h) => h.textContent)[0]).toBe(
      "Habilidades de comunicación",
    );
    expect(text).toContain("Migration owned end to end.");
    expect(text).toContain("Specific where it counted; vague on GraphQL.");
    expect(root.querySelector("[data-transcript-line] span")?.textContent).toContain("Entrevistador");
  });
});
