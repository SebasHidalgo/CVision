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
 * `null` where the section deliberately has no number: the ATS and
 * requirements sections report evidence, and a score there was either
 * unmeasurable ("improve my ATS score") or a second copy of overall fit.
 */
export function dimensionScores(
  feedback: ResumeAnalysisFeedback,
): Record<DimensionId, number | null> {
  return {
    fit: null,
    experience: feedback.experienceAndImpact.score,
    skills: feedback.skills.score,
    education: feedback.educationAndCertifications.score,
    tone: feedback.toneAndClarity.score,
    ats: null,
  };
}
