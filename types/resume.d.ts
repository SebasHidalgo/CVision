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
  createdAt: string;
};
