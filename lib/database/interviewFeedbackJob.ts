import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { handleError } from "@/lib/error/handleError";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";

/**
 * Data access for feedback generation. No session: the generator runs from
 * the webhook's `after()`, from the feedback page and from the legacy
 * action, and only ever by interview id. Every write is scoped by the
 * status it expects to find, which is what makes two concurrent generators
 * produce one model call: the claim is a conditional update, and the loser
 * updates zero rows.
 */

/** A GENERATING claim older than this is a dead worker and may be taken over. */
export const FEEDBACK_CLAIM_STALE_MS = 2 * 60_000;

const claimedSelect = {
  id: true,
  role: true,
  transcript: true,
  transcriptSource: true,
  issuedContext: true,
  durationSeconds: true,
  tier: true,
  feedbackAttempts: true,
  resumeAnalysis: {
    select: {
      jobTitle: true,
      companyName: true,
      jobDescription: true,
      feedback: { select: { overall: true, jobFit: true } },
    },
  },
} satisfies Prisma.InterviewSelect;

export type ClaimedInterview = Prisma.InterviewGetPayload<{ select: typeof claimedSelect }>;

/**
 * Takes the row for one generation attempt. Null when it is not ready
 * (no transcript stored yet), already done, or held by a live generator.
 */
export async function claimInterviewForFeedback(
  interviewId: string,
  now = new Date(),
): Promise<ClaimedInterview | null> {
  try {
    const claimed = await prisma.interview.updateMany({
      where: {
        id: interviewId,
        OR: [
          { status: "FEEDBACK_PENDING" },
          {
            status: "GENERATING",
            feedbackStartedAt: { lt: new Date(now.getTime() - FEEDBACK_CLAIM_STALE_MS) },
          },
        ],
      },
      data: {
        status: "GENERATING",
        feedbackStartedAt: now,
        feedbackAttempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) return null;

    return await prisma.interview.findUnique({
      where: { id: interviewId },
      select: claimedSelect,
    });
  } catch (error) {
    handleError(error, "Failed to claim interview for feedback");
  }
}

/** Hands the row back for another attempt. */
export async function releaseInterviewFeedback(params: {
  interviewId: string;
  reason: string;
}): Promise<boolean> {
  try {
    const result = await prisma.interview.updateMany({
      where: { id: params.interviewId, status: "GENERATING" },
      data: { status: "FEEDBACK_PENDING", failureReason: params.reason },
    });
    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to release interview feedback claim");
  }
}

/** Gives up on this interview's feedback. */
export async function failInterviewFeedback(params: {
  interviewId: string;
  reason: string;
}): Promise<boolean> {
  try {
    const result = await prisma.interview.updateMany({
      where: { id: params.interviewId, status: "GENERATING" },
      data: { status: "FAILED", failureReason: params.reason },
    });
    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to mark interview feedback as failed");
  }
}

/**
 * Stores the feedback and completes the interview in one transaction,
 * guarded on the claim: if the row is no longer GENERATING (a stale-claim
 * takeover finished first), nothing is written and the caller learns it
 * from null.
 */
export async function completeInterviewFeedback(params: {
  interviewId: string;
  totalScore: number;
  report: InterviewFeedbackReport;
}): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const completed = await tx.interview.updateMany({
        where: { id: params.interviewId, status: "GENERATING" },
        data: { status: "COMPLETED", failureReason: null },
      });
      if (completed.count === 0) return null;

      const data = {
        totalScore: params.totalScore,
        report: params.report as Prisma.InputJsonValue,
      };
      const feedback = await tx.interviewFeedback.upsert({
        where: { interviewId: params.interviewId },
        create: { interviewId: params.interviewId, ...data },
        update: data,
      });
      return feedback.id;
    });
  } catch (error) {
    handleError(error, "Failed to complete interview feedback");
  }
}
