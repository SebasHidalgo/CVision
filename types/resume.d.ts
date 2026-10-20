import type { InterviewStatus } from "@prisma/client";

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
  /** The CV's key in the private bucket; a read URL is signed from it on demand. */
  resumeKey: string;
  userId: string;
  feedback: ResumeAnalysisFeedback | null;
  /** Every rehearsal of this analysis, newest attempt first. */
  interviews: InterviewAttempt[];
  createdAt: string;
};

/** One rehearsal as the analysis page lists it. */
export type InterviewAttempt = {
  id: string;
  status: InterviewStatus;
  attemptNumber: number;
  /** The feedback's total, once there is one. */
  totalScore: number | null;
  createdAt: string;
};
