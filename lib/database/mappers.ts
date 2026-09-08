import { Prisma } from "@prisma/client";
import type { ResumeAnalysis } from "@/types/resume";
import type { InterviewFeedback } from "@/types/interview";
import { resumeFeedbackSchema } from "@/lib/schemas/resumeSchema";

/** Single source for the resume + feedback read shape. */
export const resumeInclude = {
  feedback: { omit: { id: true, resumeId: true } },
  // Enough to route from an analysis to its interview, or its feedback.
  Interview: { select: { id: true, finalized: true } },
} satisfies Prisma.ResumeAnalysisInclude;

export type DbResumeWithFeedback = Prisma.ResumeAnalysisGetPayload<{
  include: typeof resumeInclude;
}>;

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
      ? { id: db.Interview.id, finalized: db.Interview.finalized }
      : null,
    createdAt: db.createdAt.toISOString(),
  };
}

export function mapDbInterviewFeedback(
  db: DbInterviewFeedback
): InterviewFeedback {
  return {
    id: db.id,
    interviewId: db.interviewId,
    role: db.interview.role,
    createdAt: db.interview.createdAt.toISOString(),
    recordingUrl: db.interview.recordingUrl,
    totalScore: db.totalScore,
    categoryScores: db.categoryScores as InterviewFeedback["categoryScores"],
    strengths: db.strengths,
    areasForImprovement: db.areasForImprovement,
    finalAssessment: db.finalAssessment,
  };
}
