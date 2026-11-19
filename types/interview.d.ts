import type { InterviewStatus } from "@prisma/client";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import type { CallEndReason } from "@/lib/voice/callEnd";

export type { CreateInterviewInput } from "@/lib/schemas/interviewSchema";
export type { InterviewSessionResponse } from "@/lib/schemas/interviewSessionSchema";

/** One interview as the interviews list reads it. */
export type InterviewListItem = {
  id: string;
  role: string;
  status: InterviewStatus;
  createdAt: Date;
  /** The analysis it rehearses; null for a row that outlived it. */
  analysisId: string | null;
  companyName: string | null;
  /** 1 for the first rehearsal of its analysis, 2 for the next. */
  attemptNumber: number;
  /** Latest issued voice session, and how many have been issued. */
  conversationId: string | null;
  /** The latest call's record is stored. */
  hasTranscript: boolean;
  startCount: number;
  startedAt: Date | null;
  endedAt: Date | null;
  /** Why the latest step produced nothing; see `FEEDBACK_FAILURE_REASONS`. */
  failureReason: string | null;
  /** Holds a reserved unit: a reconnect reuses it. */
  held: boolean;
  /** Until when a dropped call can be resumed. */
  resumableUntil: Date | null;
  /** Why the latest call ended, when it is stored. */
  lastEnd: CallEndReason | null;
  /** The feedback's total, once there is one. */
  score: number | null;
  /** Interview time left for a resumable one; null for every other. */
  secondsLeft: number | null;
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
