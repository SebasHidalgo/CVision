import { describe, expect, it } from "vitest";
import { resumeAnalysisPrompt } from "@/lib/ai/prompts/cv-analysis.prompt";
import { numberLines } from "@/lib/ai/prompts/requirement-extraction.prompt";
import { checkExtraction } from "@/lib/ai/requirementExtraction";
import { alignFixedRequirements } from "@/lib/ai/resumeAnalysis";
import type { Requirement } from "@/lib/schemas/resumeSchema";

const POSTING = `Backend Developer

Required qualifications
- 3+ years of backend experience.
- Working proficiency in written and spoken English.

We offer flexible hours.`;

describe("numberLines", () => {
  it("numbers the non-blank lines from 1, trimmed", () => {
    expect(numberLines(POSTING)).toEqual([
      { number: 1, text: "Backend Developer" },
      { number: 2, text: "Required qualifications" },
      { number: 3, text: "- 3+ years of backend experience." },
      { number: 4, text: "- Working proficiency in written and spoken English." },
      { number: 5, text: "We offer flexible hours." },
    ]);
  });
});

describe("checkExtraction", () => {
  it("keeps verbatim quotes, tolerates case and punctuation, drops the rest, and finds unaccounted lines", () => {
    const result = checkExtraction(POSTING, 5, {
      lines: [
        { line: 1, role: "heading", requirementIds: [] },
        { line: 2, role: "heading", requirementIds: [] },
        { line: 3, role: "requirement", requirementIds: ["r1"] },
        { line: 5, role: "benefit", requirementIds: [] },
        { line: 5, role: "benefit", requirementIds: [] },
        { line: 9, role: "benefit", requirementIds: [] },
      ],
      requirements: [
        { id: "r1", requirement: "3+ years of backend experience", kind: "required", lines: [3], quote: "3+ years of backend experience." },
        { id: "r2", requirement: "English", kind: "required", lines: [4], quote: "working proficiency in written and spoken english" },
        { id: "r3", requirement: "A degree", kind: "preferred", lines: [4], quote: "A degree in Computer Science" },
        { id: "r4", requirement: "Nothing", kind: "preferred", lines: [4], quote: "  " },
      ],
    });
    expect(result.requirements.map((one) => [one.requirement, one.quoteNormalized])).toEqual([
      ["3+ years of backend experience", false],
      ["English", true],
    ]);
    expect(result.dropped).toEqual([
      { requirement: "A degree", reason: "quote-not-in-posting" },
      { requirement: "Nothing", reason: "empty-quote" },
    ]);
    expect(result.unaccountedLines).toEqual([4]);
    expect(result.bogusLines).toEqual([5, 9]);
    expect(result.roles).toMatchObject({ heading: 2, requirement: 1, benefit: 1 });
  });
});

const entry = (requirement: string, kind: Requirement["kind"], status: Requirement["status"]): Requirement => ({
  requirement,
  kind,
  status,
  evidence: "",
  note: "",
});

describe("alignFixedRequirements", () => {
  const fixed = [
    { requirement: "3+ years of backend experience", kind: "required" as const },
    { requirement: "Working proficiency in written and spoken English", kind: "required" as const },
  ];

  it("pins text and kind by position when the counts match", () => {
    const { requirements, alignment } = alignFixedRequirements(fixed, [
      entry("3+ years backend", "preferred", "met"),
      entry("English", "required", "missing"),
    ]);
    expect(requirements.map((one) => [one.requirement, one.kind, one.status])).toEqual([
      ["3+ years of backend experience", "required", "met"],
      ["Working proficiency in written and spoken English", "required", "missing"],
    ]);
    expect(alignment).toEqual({ fixed: 2, model: 2, unmatched: 0, extra: 0, byIndex: true });
  });

  it("matches by text when the counts differ and reports what it could not place", () => {
    const { requirements, alignment } = alignFixedRequirements(fixed, [
      entry("Kubernetes", "preferred", "missing"),
      entry("working proficiency in written and spoken English.", "required", "met"),
      entry("Docker", "preferred", "missing"),
    ]);
    expect(requirements.map((one) => [one.requirement, one.status])).toEqual([["Working proficiency in written and spoken English", "met"]]);
    expect(alignment).toEqual({ fixed: 2, model: 3, unmatched: 1, extra: 2, byIndex: false });
  });
});

describe("the analysis prompt", () => {
  const base = { jobTitle: "Backend Developer", jobDescription: POSTING, resumeText: "A CV", now: new Date("2026-11-03T00:00:00Z") };

  it("adds nothing when no experiment option is set", () => {
    const prompt = resumeAnalysisPrompt(base);
    expect(prompt).not.toContain("attached as a PDF");
    expect(prompt).not.toContain("extracted beforehand");
    expect(prompt).toBe(resumeAnalysisPrompt({ ...base, pdfAttached: false, fixedRequirements: undefined }));
  });

  it("carries the fixed list, numbered with its kinds, and the PDF note on request", () => {
    const prompt = resumeAnalysisPrompt({ ...base, pdfAttached: true, fixedRequirements: [{ requirement: "English", kind: "required" }] });
    expect(prompt).toContain("attached as a PDF");
    expect(prompt).toContain("exactly these 1 entries");
    expect(prompt).toContain("1. [required] English");
  });
});
