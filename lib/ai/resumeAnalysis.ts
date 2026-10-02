import "server-only";

import { generateJson } from "@/lib/ai/client";
import { resumeAnalysisPrompt } from "@/lib/ai/prompts/cv-analysis.prompt";
import {
  resumeFeedbackSchema,
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

export type AnalyzeResumeInput = {
  jobTitle: string;
  jobDescription: string;
  /** Raw text of the CV; truncation happens here, not at the call site. */
  resumeText: string;
  timeoutMs?: number;
  /**
   * Experimental, scripts/eval only and wired into nothing in production:
   * send the CV as a PDF for the model to read itself, instead of its text.
   */
  pdf?: Uint8Array;
};

/** What stands in for the CV text when the PDF itself is attached. */
const PDF_INSTEAD_OF_TEXT = "(provided as the attached PDF file)";

export type TruncatedText = {
  /** What the model is given. */
  text: string;
  chars: number;
  charsSent: number;
  truncated: boolean;
};

export type AnalyzeResumeResult = {
  feedback: ResumeAnalysisFeedback;
  /** What the model actually read, so callers never have to infer it. */
  resumeText: Omit<TruncatedText, "text">;
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
}: AnalyzeResumeInput): Promise<AnalyzeResumeResult> {
  const { text, ...sent } = truncateResumeText(resumeText);

  if (sent.truncated) {
    // Lengths only, never content. Analyzing part of a CV must leave a trace.
    console.warn(
      `[CVision][ai] resume text truncated: ${sent.chars} -> ${sent.charsSent} chars`,
    );
  }

  const feedback = await generateJson({
    prompt: resumeAnalysisPrompt({
      jobTitle,
      jobDescription,
      resumeText: pdf ? PDF_INSTEAD_OF_TEXT : text,
      // Resolved here, per call: the model has to judge end dates against the
      // day of the request, not the day of the last deploy.
      now: new Date(),
    }),
    schema: resumeFeedbackSchema,
    timeoutMs,
    ...(pdf ? { files: [{ data: pdf, mediaType: "application/pdf" }] } : {}),
  });

  return { feedback, resumeText: sent };
}
