export type {
  CreateInterviewInput,
  SubmitInterviewFeedbackInput,
} from "@/lib/schemas/interviewSchema";

export type Interview = {
  id: string;
  role: string;
  techstack: string[];
  userId: string;
  finalized: boolean;
  createdAt: Date;
  recordingUrl: string | null;
  resumeAnalysisId: string | null;
};

export type InterviewFeedback = {
  id: string;
  interviewId: string;
  /** From the interview: what the report is about and when it happened. */
  role: string;
  createdAt: string;
  recordingUrl: string | null;
  totalScore: number;
  categoryScores: Array<{
    name: string;
    score: number;
    comment: string;
  }>;
  strengths: string[];
  areasForImprovement: string[];
  finalAssessment: string;
};
