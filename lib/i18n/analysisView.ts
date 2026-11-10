import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import type { Locale } from "./config";
import { renderSentences } from "./sentences";

/**
 * A stored analysis as text in one language: the code-made sentences (headline, outcome sentences,
 * notes) rendered, joined to the model's prose the way the pipeline always joined them, and the data
 * fields dropped. Rows stored before the sentences were data pass through unchanged. Pure.
 */

type Overall = ResumeAnalysisFeedback["overall"];
type JobFit = ResumeAnalysisFeedback["jobFit"];

export function renderOverall({ headline, ...overall }: Overall, locale: Locale): Overall {
  if (!headline) return overall;
  return { ...overall, summaryText: [renderSentences(headline, locale), overall.summaryText].filter(Boolean).join(" ") };
}

export function renderJobFit({ outcomes, ...jobFit }: JobFit, locale: Locale): JobFit {
  return {
    ...jobFit,
    description: outcomes ? [renderSentences(outcomes, locale), jobFit.description].filter(Boolean).join(" ") : jobFit.description,
    requirements: jobFit.requirements.map(({ noteSentences, ...requirement }) =>
      noteSentences ? { ...requirement, note: renderSentences(noteSentences, locale) } : requirement,
    ),
  };
}

export function renderAnalysis(feedback: ResumeAnalysisFeedback, locale: Locale): ResumeAnalysisFeedback {
  return { ...feedback, overall: renderOverall(feedback.overall, locale), jobFit: renderJobFit(feedback.jobFit, locale) };
}

/** The analysis in English, the form every English-only reader takes (the interviewer, the feedback prompt, the eval). */
export function englishView(feedback: ResumeAnalysisFeedback): ResumeAnalysisFeedback {
  return renderAnalysis(feedback, "en");
}
