import { Prisma } from "@prisma/client";
import type { InterviewAttempt, ResumeAnalysis } from "@/types/resume";
import type { InterviewFeedback, InterviewListItem } from "@/types/interview";
import { interviewFeedbackReportSchema } from "@/lib/ai/schemas";
import { readCallEnd } from "@/lib/voice/callEnd";
import { resumeFeedbackSchema } from "@/lib/schemas/resumeSchema";
import { interviewStarted } from "@/lib/interviewStatus";

/** Single source for the resume + feedback read shape. */
export const resumeInclude = {
  feedback: { omit: { id: true, resumeId: true } },
  // Enough to list the rehearsals and route to each one or its feedback.
  interviews: {
    select: {
      id: true,
      status: true,
      attemptNumber: true,
      failureReason: true,
      createdAt: true,
      startCount: true,
      usageEventId: true,
      resumableUntil: true,
      issuedConversationIds: true,
      InterviewFeedback: { select: { totalScore: true } },
    },
    orderBy: { attemptNumber: "desc" },
  },
} satisfies Prisma.ResumeAnalysisInclude;

export type DbResumeWithFeedback = Prisma.ResumeAnalysisGetPayload<{
  include: typeof resumeInclude;
}>;

/**
 * Columns no screen reads here: the transcript and the issued context can be
 * tens of kilobytes per row (the feedback page reads the transcript through
 * its own query).
 */
export const interviewOmit = {
  transcript: true,
  issuedContext: true,
  segments: true,
} satisfies Prisma.InterviewOmit;

/** Feedback plus what the report needs from its interview. */
export const feedbackInclude = {
  interview: { select: { role: true, createdAt: true } },
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
    resumeKey: db.resumeKey,
    userId: db.userId,
    feedback: parsed?.success ? parsed.data : null,
    // A room that never started is not an interview: kept apart, for the CTA that reopens it.
    interviews: db.interviews.filter(interviewStarted).map(mapAttempt),
    unstartedRoom: db.interviews.filter((interview) => !interviewStarted(interview)).map(mapAttempt)[0] ?? null,
    createdAt: db.createdAt.toISOString(),
  };
}

function mapAttempt(interview: DbResumeWithFeedback["interviews"][number]): InterviewAttempt {
  return {
    id: interview.id,
    status: interview.status,
    attemptNumber: interview.attemptNumber,
    failureReason: interview.failureReason,
    totalScore: interview.InterviewFeedback?.totalScore ?? null,
    createdAt: interview.createdAt.toISOString(),
    startCount: interview.startCount,
    held: interview.usageEventId !== null,
    resumableUntil: interview.resumableUntil?.toISOString() ?? null,
  };
}

/** What the interviews list reads of a row: never the transcript, the segments or the issued context. */
export const interviewListSelect = {
  id: true,
  role: true,
  status: true,
  createdAt: true,
  resumeAnalysisId: true,
  attemptNumber: true,
  conversationId: true,
  transcriptSource: true,
  startCount: true,
  startedAt: true,
  lastSessionAt: true,
  callAllowedSeconds: true,
  endedAt: true,
  failureReason: true,
  usageEventId: true,
  resumableUntil: true,
  callEnd: true,
  resumeAnalysis: { select: { companyName: true } },
  InterviewFeedback: { select: { totalScore: true } },
} satisfies Prisma.InterviewSelect;

export type DbInterviewListRow = Prisma.InterviewGetPayload<{ select: typeof interviewListSelect }>;

/** A list row in the list's words; `secondsLeft` is the interview time a resumable one has left, read apart. */
export function mapDbInterviewListItem(db: DbInterviewListRow, secondsLeft: number | null): InterviewListItem {
  return {
    id: db.id,
    role: db.role,
    status: db.status,
    createdAt: db.createdAt,
    analysisId: db.resumeAnalysisId,
    companyName: db.resumeAnalysis?.companyName ?? null,
    attemptNumber: db.attemptNumber,
    conversationId: db.conversationId,
    hasTranscript: db.transcriptSource != null,
    startCount: db.startCount,
    startedAt: db.startedAt ?? null,
    lastSessionAt: db.lastSessionAt ?? null,
    callAllowedSeconds: db.callAllowedSeconds ?? null,
    endedAt: db.endedAt ?? null,
    failureReason: db.failureReason ?? null,
    held: db.usageEventId != null,
    resumableUntil: db.resumableUntil ?? null,
    lastEnd: readCallEnd(db.callEnd)?.reason ?? null,
    score: db.InterviewFeedback?.totalScore ?? null,
    secondsLeft,
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
    totalScore: db.totalScore,
    report: parsed.data,
  };
}
