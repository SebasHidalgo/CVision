import type { RequirementId } from "@/screens/Home/utils/exampleCase";

// The rest of the example's report: the readings beside the verdict and the fixes. Structure only; the words are in
// locales/<lang>/landingAnalysis.json. Only experience, skills and education carry a score, as in the app.

export const READING_IDS = ["ats", "experience", "skills", "education", "tone"] as const;
export type ReadingId = (typeof READING_IDS)[number];

export const READING_SCORES: Record<ReadingId, number | null> = {
  ats: null,
  experience: 74,
  skills: 72,
  education: 63,
  tone: null,
};

/** The CV's quality on its own, as the analysis page's header shows it. */
export const QUALITY_SCORE = 69;

export const FIXES = [
  { id: "database", impact: "high" },
  { id: "aws", impact: "high" },
  { id: "dashboard", impact: "medium" },
] as const satisfies readonly { id: string; impact: "high" | "medium" }[];

/** The requirement whose CV line the pull quote holds up. */
export const PROOF_REQUIREMENT: RequirementId = "r2";
