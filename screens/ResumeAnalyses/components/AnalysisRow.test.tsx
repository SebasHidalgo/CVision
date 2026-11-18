// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tFor } from "@/lib/i18n/testing";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import type { InterviewAttempt, ResumeAnalysis } from "@/types/resume";
import { AnalysisRow } from "./AnalysisRow";

vi.mock("next/font/google", () => ({ Host_Grotesk: () => ({ variable: "font-text" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/screens/ResumeAnalyses/actions/deleteOneAnalysisAction", () => ({ deleteOneAnalysisAction: vi.fn() }));

afterEach(cleanup);

// The row reads only jobFit.requirements' kind and status from the feedback.
const feedback = (rows: { kind: "required" | "preferred"; status: string }[]) =>
  ({ jobFit: { requirements: rows } }) as unknown as ResumeAnalysisFeedback;
const attempt = (patch: Partial<InterviewAttempt>): InterviewAttempt => ({
  id: "i1",
  status: "COMPLETED",
  attemptNumber: 1,
  failureReason: null,
  totalScore: null,
  createdAt: "2026-11-03T00:00:00.000Z",
  startCount: 1,
  held: false,
  resumableUntil: null,
  ...patch,
});
const analysis = (patch: Partial<ResumeAnalysis>): ResumeAnalysis => ({
  id: "a1",
  companyName: "Northwind",
  jobTitle: "Data Analyst",
  jobDescription: "",
  resumeKey: "cv/user_1/a1.pdf",
  userId: "user_1",
  feedback: feedback([
    { kind: "required", status: "met" },
    { kind: "required", status: "met" },
    { kind: "preferred", status: "met" },
    { kind: "preferred", status: "partial" },
    { kind: "preferred", status: "met" },
  ]),
  interviews: [],
  createdAt: "2026-11-02T00:00:00.000Z",
  ...patch,
});

const mount = (value: ResumeAnalysis) =>
  render(
    <ol>
      <AnalysisRow analysis={value} n="01" locale="en" t={tFor("analyses")} common={tFor("common")} entitlement={null} headingId="analyses-title" />
    </ol>,
  );

describe("AnalysisRow", () => {
  it("links to the analysis with its date, job, verdict, arithmetic and latest rehearsal", () => {
    mount(analysis({ interviews: [attempt({ attemptNumber: 2, totalScore: 74 }), attempt({ status: "FAILED" })] }));
    const row = document.querySelector("[data-analysis-row]") as HTMLElement;
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/resume/analysis/a1");
    expect(row.textContent).toContain("Nov 2, 2026");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Northwind");
    expect(row.textContent).toContain("Data Analyst");
    expect(row.textContent).toContain("Strong fit");
    expect(row.textContent).toContain("2 of 2 required, 2 of 3 preferred (+1 partial)");
    expect(row.textContent).toContain("Attempt 2 · Scored 74");
    expect(row.textContent).toContain("+1 earlier");
    // One mark per requirement, decorative.
    expect(row.querySelectorAll("[data-status]")).toHaveLength(5);
  });

  it("says when there is no rehearsal yet", () => {
    mount(analysis({}));
    expect(document.querySelector("[data-analysis-row]")?.textContent).toContain("No interview yet");
  });

  it("has no link for an analysis it can't read, and offers to delete it", () => {
    mount(analysis({ feedback: null }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("[data-analysis-row]")?.textContent).toContain("We couldn't read this analysis. Run it again.");
    expect(screen.getByRole("button", { name: "Delete Data Analyst at Northwind, Nov 2, 2026" })).toBeTruthy();
  });
});
