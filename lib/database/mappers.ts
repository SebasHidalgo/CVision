import { Prisma, type InterviewStatus } from "@prisma/client";
import type { ResumeAnalysis } from "@/types/resume";
import type { Interview, InterviewFeedback } from "@/types/interview";
import { interviewFeedbackReportSchema } from "@/lib/ai/schemas";
import { resumeFeedbackSchema } from "@/lib/schemas/resumeSchema";

/**
 * `finalized` is derived, never read from its column: the column is legacy
 * (write-only until M3-D removes it) and `status` is the source of truth.
 */
export function isFinalized(status: InterviewStatus): boolean {
  return status === "COMPLETED";
}

/** Single source for the resume + feedback read shape. */
export const resumeInclude = {
  feedback: { omit: { id: true, resumeId: true } },
  // Enough to route from an analysis to its interview, or its feedback.
  Interview: { select: { id: true, status: true } },
} satisfies Prisma.ResumeAnalysisInclude;

export type DbResumeWithFeedback = Prisma.ResumeAnalysisGetPayload<{
  include: typeof resumeInclude;
}>;

/**
 * Columns no screen reads: the transcript and the issued context can be
 * tens of kilobytes per row, and `finalized` is derived above.
 */
export const interviewOmit = {
  transcript: true,
  issuedContext: true,
  finalized: true,
} satisfies Prisma.InterviewOmit;

export type DbInterview = Prisma.InterviewGetPayload<{ omit: typeof interviewOmit }>;

/** Feedback plus what the report needs from its interview. */
export const feedbackInclude = {
  interview: { select: { role: true, createdAt: true, recordingUrl: true } },
} satisfies Prisma.InterviewFeedbackInclude;

export type DbInterviewFeedback = Prisma.InterviewFeedbackGetPayload<{
  include: typeof feedbackInclude;
}>;

/**
 * Prisma row -> domain type. The feedback is validated rather than cast, so a
 * row that no longer matches the schema surfaces as `null` instead of breaking
 * mid-render.
 */
export function mapDbResume(db: DbResumeWithFeedback): ResumeAnalysis {
  const parsed = db.feedback
    ? resumeFeedbackSchema.safeParse(db.feedback)
    : null;

  if (db.feedback && !parsed?.success) {
    console.warn(`[CVision] Resume ${db.id} has feedback outside the schema`);
  }

  return {
    id: db.id,
    companyName: db.companyName,
    jobTitle: db.jobTitle,
    jobDescription: db.jobDescription,
    resumeUrl: db.resumeUrl,
    userId: db.userId,
    feedback: parsed?.success ? parsed.data : null,
    interview: db.Interview
      ? {
          id: db.Interview.id,
          status: db.Interview.status,
          finalized: isFinalized(db.Interview.status),
        }
      : null,
    createdAt: db.createdAt.toISOString(),
  };
}

export function mapDbInterview(db: DbInterview): Interview {
  return {
    id: db.id,
    role: db.role,
    techstack: db.techstack,
    userId: db.userId,
    status: db.status,
    finalized: isFinalized(db.status),
    createdAt: db.createdAt,
    recordingUrl: db.recordingUrl,
    resumeAnalysisId: db.resumeAnalysisId,
    conversationId: db.conversationId,
    startCount: db.startCount,
    startedAt: db.startedAt,
    endedAt: db.endedAt,
    durationSeconds: db.durationSeconds,
    failureReason: db.failureReason,
  };
}

/**
 * The stored report is validated, not cast. A row written before the M3-B
 * shape (or by a later one) reads as `null`, and the page says the feedback
 * is unavailable instead of rendering half a report.
 */
export function mapDbInterviewFeedback(
  db: DbInterviewFeedback
): InterviewFeedback | null {
  const parsed = interviewFeedbackReportSchema.safeParse(db.report);
  if (!parsed.success) {
    console.warn(`[CVision] Interview feedback ${db.id} is outside the schema`);
    return null;
  }

  return {
    id: db.id,
    interviewId: db.interviewId,
    role: db.interview.role,
    createdAt: db.interview.createdAt.toISOString(),
    recordingUrl: db.interview.recordingUrl,
    totalScore: db.totalScore,
    report: parsed.data,
  };
}
