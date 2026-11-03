import "server-only";

import {
  describeCounts,
  emptyGuardReport,
  guardAnalysis,
  type GuardReport,
} from "@/lib/ai/analysisGuardrails";
import { loosen, normalizeWhitespace } from "@/lib/ai/analysisChecks";
import { generateJson } from "@/lib/ai/client";
import { resumeAnalysisPrompt } from "@/lib/ai/prompts/cv-analysis.prompt";
import {
  resumeFeedbackSchema,
  type Requirement,
  type RequirementKind,
  type ResumeAnalysisFeedback,
} from "@/lib/schemas/resumeSchema";

/**
 * Bounds the prompt: a CV longer than this is cut, not rejected. Set well
 * past any real CV — a dense 10-page one is around 30,000 characters — so the
 * cap only catches someone pasting a book. At roughly 4 characters per token
 * it is ~37k tokens, 3.6% of the model's 1,048,576-token context, and about a
 * cent of input at $0.30 per million. The old 20,000 came from the 8k-token
 * context of the local model and silently cut real CVs.
 */
export const MAX_RESUME_TEXT_CHARS = 150_000;

// Measured at 5.6-7.0 s across the scripts/eval runs; 30 s is over 4x the
// slowest. The maxDuration of app/(root)/resume/upload is sized on top of this.
export const ANALYSIS_TIMEOUT_MS = 30_000;

/** Experimental (scripts/eval only): what the model is given as the CV. */
export type AnalysisInputMode = "text" | "pdf" | "pdf+text";

/** Experimental (scripts/eval only): a requirement extracted before the analysis call. */
export type FixedRequirement = { requirement: string; kind: RequirementKind };

export type AnalyzeResumeInput = {
  jobTitle: string;
  jobDescription: string;
  /** Raw text of the CV; truncation happens here, not at the call site. */
  resumeText: string;
  timeoutMs?: number;
  /**
   * Experimental, scripts/eval only and wired into nothing in production: the
   * CV as a PDF, sent instead of its text ("pdf") or beside it ("pdf+text").
   */
  pdf?: Uint8Array;
  inputMode?: AnalysisInputMode;
  /**
   * Experimental, scripts/eval only: the posting's requirements, extracted by
   * a separate call. The model then only decides status, evidence and note.
   */
  fixedRequirements?: FixedRequirement[];
};

/** What stands in for the CV text when only the PDF is attached. */
const PDF_INSTEAD_OF_TEXT = "(provided as the attached PDF file)";

export type TruncatedText = {
  /** What the model is given. */
  text: string;
  chars: number;
  charsSent: number;
  truncated: boolean;
};

/** How the model's list was reconciled with a fixed requirement list. */
export type RequirementAlignment = {
  fixed: number;
  model: number;
  /** Fixed requirements the model's list did not carry; left out of the result. */
  unmatched: number;
  /** Model entries that matched no fixed requirement; dropped. */
  extra: number;
  byIndex: boolean;
};

export type AnalyzeResumeResult = {
  /** Guarded: no quote that is not in the CV, no invented figure. */
  feedback: ResumeAnalysisFeedback;
  /** What the model actually read, so callers never have to infer it. */
  resumeText: Omit<TruncatedText, "text">;
  /**
   * What the checks found before the guardrail edited anything, and what it
   * did. Cleaning the output must not hide what was cleaned, or `npm run eval`
   * would read zero violations forever.
   */
  guard: GuardReport;
  /** Present when `fixedRequirements` was given. */
  alignment?: RequirementAlignment;
};

export function truncateResumeText(resumeText: string): TruncatedText {
  const text = resumeText.slice(0, MAX_RESUME_TEXT_CHARS);
  return {
    text,
    chars: resumeText.length,
    charsSent: text.length,
    truncated: text.length < resumeText.length,
  };
}

/**
 * The model step of the analysis, start to finish. The Server Action and the
 * evaluation harness both go through here, so the harness measures the request
 * production actually sends.
 */
export async function analyzeResume({
  jobTitle,
  jobDescription,
  resumeText,
  timeoutMs = ANALYSIS_TIMEOUT_MS,
  pdf,
  inputMode = pdf ? "pdf" : "text",
  fixedRequirements,
}: AnalyzeResumeInput): Promise<AnalyzeResumeResult> {
  const { text, ...sent } = truncateResumeText(resumeText);
  if (inputMode !== "text" && !pdf) throw new Error(`inputMode ${inputMode} needs the PDF bytes`);

  if (sent.truncated) {
    // Lengths only, never content. Analyzing part of a CV must leave a trace.
    console.warn(
      `[CVision][ai] resume text truncated: ${sent.chars} -> ${sent.charsSent} chars`,
    );
  }

  const answer = await generateJson({
    prompt: resumeAnalysisPrompt({
      jobTitle,
      jobDescription,
      resumeText: inputMode === "pdf" ? PDF_INSTEAD_OF_TEXT : text,
      // Resolved here, per call: the model has to judge end dates against the
      // day of the request, not the day of the last deploy.
      now: new Date(),
      pdfAttached: inputMode === "pdf+text",
      fixedRequirements,
    }),
    schema: resumeFeedbackSchema,
    timeoutMs,
    ...(inputMode !== "text" && pdf ? { files: [{ data: pdf, mediaType: "application/pdf" }] } : {}),
  });

  let alignment: RequirementAlignment | undefined;
  if (fixedRequirements) {
    const aligned = alignFixedRequirements(fixedRequirements, answer.jobFit.requirements);
    answer.jobFit.requirements = aligned.requirements;
    alignment = aligned.alignment;
  }

  // After the schema, before anything persists it. The checks run against the
  // CV text, which is what the model was given in production and what an ATS
  // extracts; in the PDF experiments it is the text layer the quotes must
  // still come from. Only an absent text leaves the quotes unchecked.
  const { feedback, guard } = text.trim() ? guardAnalysis(text, answer) : { feedback: answer, guard: emptyGuardReport() };

  const note = describeCounts(guard.counts);
  if (note) {
    // Counts only. The intervention values carry CV text, so they stay out of
    // the logs and go to the eval harness instead.
    console.warn(`[CVision][ai] analysis guardrail fired: ${note}`);
  }

  return { feedback, resumeText: sent, guard, ...(alignment ? { alignment } : {}) };
}

/**
 * Pins the model's list to the fixed one: same count means by position, with
 * the fixed text and kind written back; otherwise by text, keeping only the
 * fixed requirements the model answered. Pure; tested.
 */
export function alignFixedRequirements(
  fixed: FixedRequirement[],
  model: Requirement[],
): { requirements: Requirement[]; alignment: RequirementAlignment } {
  if (fixed.length === model.length) {
    return {
      requirements: model.map((entry, i) => ({ ...entry, requirement: fixed[i].requirement, kind: fixed[i].kind })),
      alignment: { fixed: fixed.length, model: model.length, unmatched: 0, extra: 0, byIndex: true },
    };
  }

  const key = (text: string) => loosen(normalizeWhitespace(text));
  const used = new Set<number>();
  const requirements: Requirement[] = [];
  let unmatched = 0;
  for (const want of fixed) {
    const target = key(want.requirement);
    const index = model.findIndex((entry, i) => {
      if (used.has(i)) return false;
      const got = key(entry.requirement);
      return got === target || got.includes(target) || target.includes(got);
    });
    if (index < 0) {
      unmatched += 1;
      continue;
    }
    used.add(index);
    requirements.push({ ...model[index], requirement: want.requirement, kind: want.kind });
  }

  return {
    requirements,
    alignment: { fixed: fixed.length, model: model.length, unmatched, extra: model.length - used.size, byIndex: false },
  };
}
