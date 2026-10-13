import type { InterviewStatus } from "@prisma/client";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";

export type { CreateInterviewInput } from "@/lib/schemas/interviewSchema";
export type { InterviewSessionResponse } from "@/lib/schemas/interviewSessionSchema";

export type Interview = {
  id: string;
  role: string;
  techstack: string[];
  userId: string;
  status: InterviewStatus;
  /** Derived from `status`; the column it mirrors goes away in M3-D. */
  finalized: boolean;
  createdAt: Date;
  resumeAnalysisId: string | null;
  /** 1 for the first rehearsal of its analysis, 2 for the next. */
  attemptNumber: number;
  /** Latest issued voice session, and how many have been issued. */
  conversationId: string | null;
  startCount: number;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  /** Why the latest step produced nothing; see `FEEDBACK_FAILURE_REASONS`. */
  failureReason: string | null;
};

export type InterviewFeedback = {
  id: string;
  interviewId: string;
  /** From the interview: what the report is about and when it happened. */
  role: string;
  createdAt: string;
  totalScore: number;
  /** The validated report: gap follow-through, notable answers, scores, stats, prose. */
  report: InterviewFeedbackReport;
};
