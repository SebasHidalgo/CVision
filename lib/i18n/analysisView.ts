import { analysisProse, withProse } from "@/lib/ai/translatableProse";
import type { Sentence } from "@/lib/ai/sentences";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import type { Locale } from "./config";
import { renderSentences, sentenceTerms, type TermMap } from "./sentences";

/**
 * A stored analysis as text in one language: the code-made sentences (headline, outcome sentences,
 * notes) rendered, joined to the model's prose the way the pipeline always joined them, and the data
 * fields dropped. Rows stored before the sentences were data pass through unchanged. Pure.
 */

type Overall = ResumeAnalysisFeedback["overall"];
type JobFit = ResumeAnalysisFeedback["jobFit"];

/** A prose field whose translation has not arrived: the page shows a skeleton in its place. */
export const PENDING_PROSE = "⁠⁠pending⁠⁠";

export type RenderOptions = {
  /** The posting's words in the page's language (from the stored translation). */
  terms?: TermMap;
  /** No translation yet: prose and the sentences that name terms render as PENDING_PROSE. */
  pending?: boolean;
};

const namesTerms = (sentences: readonly Sentence[]) => sentenceTerms(sentences).size > 0;

/** Sentences that need the translation render as pending; the rest render now. */
function sentencesText(sentences: readonly Sentence[], locale: Locale, options: RenderOptions): string {
  if (options.pending && locale !== "en" && namesTerms(sentences)) return PENDING_PROSE;
  return renderSentences(sentences, locale, options.terms);
}

const joined = (parts: string[]) => (parts.includes(PENDING_PROSE) ? PENDING_PROSE : parts.filter(Boolean).join(" "));

export function renderOverall({ headline, ...overall }: Overall, locale: Locale, options: RenderOptions = {}): Overall {
  if (!headline) return overall;
  return { ...overall, summaryText: joined([sentencesText(headline, locale, options), overall.summaryText]) };
}

export function renderJobFit({ outcomes, ...jobFit }: JobFit, locale: Locale, options: RenderOptions = {}): JobFit {
  return {
    ...jobFit,
    description: outcomes ? joined([sentencesText(outcomes, locale, options), jobFit.description]) : jobFit.description,
    requirements: jobFit.requirements.map(({ noteSentences, ...requirement }) =>
      noteSentences ? { ...requirement, note: sentencesText(noteSentences, locale, options) } : requirement,
    ),
  };
}

export function renderAnalysis(feedback: ResumeAnalysisFeedback, locale: Locale, options: RenderOptions = {}): ResumeAnalysisFeedback {
  // Pending: every model-written field waits for its translation.
  const source = options.pending && locale !== "en" ? withProse(feedback, pendingProse(analysisProse(feedback))) : feedback;
  return { ...source, overall: renderOverall(source.overall, locale, options), jobFit: renderJobFit(source.jobFit, locale, options) };
}

/** Every path of a prose map as pending. */
export function pendingProse(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(map).map((path) => [path, PENDING_PROSE]));
}

/** The analysis in English, the form every English-only reader takes (the interviewer, the feedback prompt, the eval). */
export function englishView(feedback: ResumeAnalysisFeedback): ResumeAnalysisFeedback {
  return renderAnalysis(feedback, "en");
}

/** The posting's words the analysis' code-made sentences name, for the translation call. */
export function analysisSentenceTerms(feedback: ResumeAnalysisFeedback): string[] {
  const terms = new Set<string>();
  sentenceTerms(feedback.overall.headline ?? [], terms);
  sentenceTerms(feedback.jobFit.outcomes ?? [], terms);
  for (const requirement of feedback.jobFit.requirements) sentenceTerms(requirement.noteSentences ?? [], terms);
  return [...terms];
}
