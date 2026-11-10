import type { ResumeAnalysisFeedback } from "@/types/resume";

/** The report's six sections, in page order; each one's label is `analysis:dimensions.<id>.label`. */
export const DIMENSION_IDS = ["fit", "experience", "skills", "education", "tone", "ats"] as const;

export type DimensionId = (typeof DIMENSION_IDS)[number];

/**
 * `null` where the section deliberately has no number. Requirements and ATS
 * report evidence, where a score was either a second copy of overall fit or
 * unmeasurable ("improve my ATS score"). Tone lost its score to measurement:
 * it said 75-92 about every resume in the eval suite, including one for the
 * wrong profession.
 */
export function dimensionScores(
  feedback: ResumeAnalysisFeedback,
): Record<DimensionId, number | null> {
  return {
    fit: null,
    experience: feedback.experienceAndImpact.score,
    skills: feedback.skills.score,
    education: feedback.educationAndCertifications.score,
    tone: null,
    ats: null,
  };
}
