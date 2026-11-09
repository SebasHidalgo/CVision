import "server-only";

import {
  describeCounts,
  emptyGuardReport,
  guardAnalysis,
  structureAtsIssues,
  withAccentCompositions,
  withInterventions,
  type GuardReport,
  type Intervention,
} from "@/lib/ai/analysisGuardrails";
import { generateJson } from "@/lib/ai/client";
import { ENGLISH_RETRY, resumeAnalysisPrompt } from "@/lib/ai/prompts/cv-analysis.prompt";
import { nonEnglishFields } from "@/lib/ai/postingLanguage";
import {
  enforceRequirementStatuses,
  guardBulletRoles,
  guardMatchedSkills,
  requirementHeadline,
  statedTotalYears,
  structureRequirements,
  withEvidenceSources,
  withoutControlCharacters,
} from "@/lib/ai/requirementGuardrails";
import { analysisResponseSchema, type AnalysisResponse, type ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

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
  /** scripts/eval only: the date the prompt states, so the canary can replay its reference's day. */
  now?: Date;
  /** Split accents the PDF parser composed, recorded in guardStats. */
  accentsComposed?: number;
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
  now = new Date(),
  accentsComposed = 0,
}: AnalyzeResumeInput): Promise<AnalyzeResumeResult> {
  const { text, ...sent } = truncateResumeText(resumeText);
  if (inputMode !== "text" && !pdf) throw new Error(`inputMode ${inputMode} needs the PDF bytes`);

  if (sent.truncated) {
    // Lengths only, never content. Analyzing part of a CV must leave a trace.
    console.warn(
      `[CVision][ai] resume text truncated: ${sent.chars} -> ${sent.charsSent} chars`,
    );
  }

  const prompt = resumeAnalysisPrompt({
    jobTitle,
    jobDescription,
    resumeText: inputMode === "pdf" ? PDF_INSTEAD_OF_TEXT : text,
    // Resolved per call (the default above): the model has to judge end
    // dates against the day of the request, not the day of the last deploy.
    now,
    pdfAttached: inputMode === "pdf+text",
  });
  const ask = (withPrompt: string) =>
    generateJson({
      prompt: withPrompt,
      schema: analysisResponseSchema,
      timeoutMs,
      ...(inputMode !== "text" && pdf ? { files: [{ data: pdf, mediaType: "application/pdf" }] } : {}),
    });
  let answer = await ask(prompt);

  // Always English (owner decision, M8-D): prose in another language is asked for once more.
  const language: Intervention[] = [];
  const firstFields = nonEnglishFields(analysisProse(answer));
  if (firstFields > 0) {
    try {
      answer = await ask(`${prompt}\n\n${ENGLISH_RETRY}`);
      language.push({ check: "language", action: "regenerated", path: "analysis", value: `${firstFields} field(s) not in English`, replacement: `${nonEnglishFields(analysisProse(answer))} after asking again` });
    } catch (error) {
      // The first answer stands: the wrong language is better than no analysis.
      console.warn(`[CVision][ai] English retry failed: ${error instanceof Error ? error.name : "unknown"}`);
    }
  }

  // Posting quote, section, softened clause and key terms, against the posting the model read.
  const structured = structureRequirements(jobDescription, answer.jobFit.requirements);
  const ats = structureAtsIssues(answer.atsCompatibility.issues, text);
  const { issues: _issues, ...atsFields } = answer.atsCompatibility;
  const shaped: ResumeAnalysisFeedback = {
    ...answer,
    atsCompatibility: { ...atsFields, problems: ats.problems, fixes: ats.fixes },
    jobFit: { ...answer.jobFit, requirements: structured.requirements },
  };

  // After the schema, before anything persists it. The checks run against the
  // CV text, which is what the model was given in production and what an ATS
  // extracts; in the PDF experiments it is the text layer the quotes must
  // still come from. Only an absent text leaves the quotes unchecked.
  const checked = Boolean(text.trim());
  const guarded = checked ? guardAnalysis(text, shaped) : { feedback: shaped, guard: emptyGuardReport() };

  // Statuses last: a CV quote the guardrail dropped is no evidence. The analysis is written in English (owner decision, M8-D).
  const statuses = enforceRequirementStatuses(
    guarded.feedback.jobFit.requirements,
    checked ? { pending: structured.pending, cvText: text, now, statedYears: statedTotalYears(text, answer.atsCompatibility.sectionsDetected) } : undefined,
  );
  const sourced = checked
    ? withEvidenceSources(statuses.requirements, text, guarded.feedback.atsCompatibility.sectionsDetected)
    : { requirements: statuses.requirements, interventions: [] };
  const requirements = sourced.requirements;
  // After the statuses: a key term's verified CV word also proves a matched skill ("Postgres" for "PostgreSQL").
  const skills = checked
    ? guardMatchedSkills({ ...guarded.feedback, jobFit: { ...guarded.feedback.jobFit, requirements } }, text)
    : { feedback: guarded.feedback, interventions: [] };
  const roles = checked ? guardBulletRoles(skills.feedback, text) : { feedback: skills.feedback, interventions: [] };
  // The first sentence comes from the statuses, so the summary cannot contradict them.
  const headline = requirementHeadline(requirements);
  const summaryText = [headline, roles.feedback.overall.summaryText.trim()].filter(Boolean).join(" ");
  const feedback = withoutControlCharacters<ResumeAnalysisFeedback>({
    ...roles.feedback,
    overall: { ...roles.feedback.overall, summaryText },
    jobFit: { ...roles.feedback.jobFit, requirements },
  });
  const guard = withAccentCompositions(
    withInterventions(guarded.guard, [
      ...structured.interventions,
      ...statuses.interventions,
      ...sourced.interventions,
      ...skills.interventions,
      ...roles.interventions,
      ...ats.interventions,
      ...language,
    ]),
    accentsComposed,
  );

  const note = describeCounts(guard.counts);
  if (note) {
    // Counts only. The intervention values carry CV text, so they stay out of
    // the logs and go to the eval harness instead.
    console.warn(`[CVision][ai] analysis guardrail fired: ${note}`);
  }

  return { feedback, resumeText: sent, guard };
}

/** The prose the model wrote, without quotes, names or the posting's own words: what the language check reads. */
export function analysisProse(answer: AnalysisResponse): string[] {
  return [
    answer.jobFit.description,
    ...answer.jobFit.strategicRecommendations,
    ...answer.jobFit.requirements.map((requirement) => requirement.note),
    answer.overall.summaryText,
    ...answer.overall.prioritizedFixes.flatMap((fix) => [fix.title, fix.action]),
    answer.atsCompatibility.description,
    ...answer.atsCompatibility.issues.flatMap((issue) => [issue.problem, issue.fix]),
    answer.experienceAndImpact.description,
    ...answer.experienceAndImpact.strengths,
    ...answer.experienceAndImpact.weaknesses,
    answer.skills.description,
    ...answer.skills.actionPlan,
    answer.educationAndCertifications.description,
    ...answer.educationAndCertifications.improvements,
    answer.toneAndClarity.description,
    ...answer.toneAndClarity.suggestions,
  ];
}
