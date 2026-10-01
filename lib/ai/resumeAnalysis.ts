import "server-only";

import { generateJson } from "@/lib/ai/client";
import { resumeAnalysisPrompt } from "@/lib/ai/prompts/cv-analysis.prompt";
import {
  resumeFeedbackSchema,
  type ResumeAnalysisFeedback,
} from "@/lib/schemas/resumeSchema";

/** Bounds the prompt: a CV longer than this is cut, not rejected. */
export const MAX_RESUME_TEXT_CHARS = 20_000;

// Measured at 5.6-7.0 s across the scripts/eval runs; 30 s is over 4x the
// slowest. The maxDuration of app/(root)/resume/upload is sized on top of this.
export const ANALYSIS_TIMEOUT_MS = 30_000;

export type AnalyzeResumeInput = {
  jobTitle: string;
  jobDescription: string;
  /** Raw text of the CV; truncation happens here, not at the call site. */
  resumeText: string;
  timeoutMs?: number;
};

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
}: AnalyzeResumeInput): Promise<ResumeAnalysisFeedback> {
  return generateJson({
    prompt: resumeAnalysisPrompt({
      jobTitle,
      jobDescription,
      resumeText: resumeText.slice(0, MAX_RESUME_TEXT_CHARS),
    }),
    schema: resumeFeedbackSchema,
    timeoutMs,
  });
}
