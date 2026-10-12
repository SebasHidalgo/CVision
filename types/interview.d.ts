import type { InterviewStatus } from "@prisma/client";
import type { InterviewLanguage } from "@/lib/ai/postingLanguage";
import type { InterviewerVariables } from "@/lib/ai/prompts/interviewer.agent";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";

export type {
  CreateInterviewInput,
  SubmitInterviewFeedbackInput,
} from "@/lib/schemas/interviewSchema";

export type Interview = {
  id: string;
  role: string;
  techstack: string[];
  userId: string;
  status: InterviewStatus;
  /** Derived from `status`; the column it mirrors goes away in M3-D. */
  finalized: boolean;
  createdAt: Date;
  recordingUrl: string | null;
  resumeAnalysisId: string | null;
  /** Latest issued voice session, and how many have been issued. */
  conversationId: string | null;
  startCount: number;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  /** Why the latest step produced nothing; see `FEEDBACK_FAILURE_REASONS`. */
  failureReason: string | null;
};

/** What `POST /api/interview/[id]/session` returns on success. */
export type InterviewSessionResponse = {
  connectionType: "webrtc";
  /** Pass to the browser SDK as `conversationToken`. Single use, short-lived. */
  conversationToken: string;
  conversationId: string;
  /** Pass through as `dynamicVariables`; the server keeps its own copy. */
  dynamicVariables: InterviewerVariables;
  /** The one config override the agent accepts: `overrides.agent.language`. */
  language: InterviewLanguage;
  expiresAt: string;
  maxDurationSeconds: number;
};

export type InterviewFeedback = {
  id: string;
  interviewId: string;
  /** From the interview: what the report is about and when it happened. */
  role: string;
  createdAt: string;
  recordingUrl: string | null;
  totalScore: number;
  /** The validated report: gap follow-through, notable answers, scores, stats, prose. */
  report: InterviewFeedbackReport;
};
