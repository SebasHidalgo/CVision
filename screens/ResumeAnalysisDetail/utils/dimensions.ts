import type { ResumeAnalysisFeedback } from "@/types/resume";

export const DIMENSIONS = [
  { id: "fit", label: "Requirements" },
  { id: "experience", label: "Experience & impact" },
  { id: "skills", label: "Skills" },
  { id: "education", label: "Education & certifications" },
  { id: "tone", label: "Tone & clarity" },
  { id: "ats", label: "What an ATS reads" },
] as const;

export type DimensionId = (typeof DIMENSIONS)[number]["id"];

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
