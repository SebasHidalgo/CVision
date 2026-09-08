export type {
  CreateResumeInput,
  ResumeAnalysisFeedback,
} from "@/lib/schemas/resumeSchema";

import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

export type ResumeAnalysis = {
  id: string;
  companyName: string;
  jobTitle: string;
  jobDescription: string;
  resumeUrl: string;
  userId: string;
  feedback: ResumeAnalysisFeedback | null;
  /** The mock interview started from this analysis, if any. */
  interview: { id: string; finalized: boolean } | null;
  createdAt: string;
};
