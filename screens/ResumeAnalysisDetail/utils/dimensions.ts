import type { ResumeAnalysisFeedback } from "@/types/resume";

export const DIMENSIONS = [
  { id: "ats", label: "ATS compatibility" },
  { id: "experience", label: "Experience & impact" },
  { id: "skills", label: "Skills" },
  { id: "education", label: "Education & certifications" },
  { id: "tone", label: "Tone & clarity" },
  { id: "fit", label: "Job fit" },
] as const;

export type DimensionId = (typeof DIMENSIONS)[number]["id"];

export function dimensionScores(
  feedback: ResumeAnalysisFeedback,
): Record<DimensionId, number> {
  return {
    ats: feedback.atsCompatibility.score,
    experience: feedback.experienceAndImpact.score,
    skills: feedback.skills.score,
    education: feedback.educationAndCertifications.score,
    tone: feedback.toneAndClarity.score,
    fit: feedback.jobFit.score,
  };
}
