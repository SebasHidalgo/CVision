import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { handleError } from "@/lib/error/handleError";
import { NotFoundError } from "@/lib/error/errors";
import type { Interview, InterviewFeedback } from "@/types/interview";
import type { FeedbackObject } from "@/lib/ai/schemas";
import { feedbackInclude, mapDbInterviewFeedback } from "./mappers";

const interviewDetailInclude = {
  resumeAnalysis: { select: { jobDescription: true, jobTitle: true } },
} satisfies Prisma.InterviewInclude;

export type InterviewWithResume = Prisma.InterviewGetPayload<{
  include: typeof interviewDetailInclude;
}>;

export type CreateInterviewData = {
  role: string;
  techstack: string[];
  resumeId: string;
};

export async function createInterview(
  data: CreateInterviewData
): Promise<string> {
  try {
    const userId = await requireUserId();

    const dbInterview = await prisma.interview.create({
      data: {
        role: data.role,
        techstack: data.techstack,
        userId,
        resumeAnalysisId: data.resumeId,
      },
    });

    return dbInterview.id;
  } catch (error) {
    handleError(error, "Failed to create interview record");
  }
}

export async function fetchAllInterviews(): Promise<Interview[]> {
  try {
    const userId = await requireUserId();

    return await prisma.interview.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    handleError(error, "Failed to retrieve all interview records");
  }
}

/** `null` when it doesn't exist or belongs to another user. */
export async function fetchInterviewById(
  interviewId: string
): Promise<InterviewWithResume | null> {
  try {
    const userId = await requireUserId();

    return await prisma.interview.findFirst({
      where: { id: interviewId, userId },
      include: interviewDetailInclude,
    });
  } catch (error) {
    handleError(error, "Failed to retrieve interview record");
  }
}

/**
 * Closes an interview: stores the feedback, marks it finalized and attaches the
 * recording. One atomic write with `userId` in the `where`, so it is a no-op on
 * someone else's interview.
 */
export async function saveInterviewFeedback(params: {
  interviewId: string;
  feedback: FeedbackObject;
  recordingUrl?: string;
}): Promise<string> {
  const { interviewId, feedback, recordingUrl } = params;

  try {
    const userId = await requireUserId();

    const updated = await prisma.interview.update({
      where: { id: interviewId, userId },
      data: {
        finalized: true,
        ...(recordingUrl ? { recordingUrl } : {}),
        InterviewFeedback: {
          create: {
            totalScore: feedback.totalScore,
            categoryScores: feedback.categoryScores as Prisma.InputJsonValue,
            strengths: feedback.strengths,
            areasForImprovement: feedback.areasForImprovement,
            finalAssessment: feedback.finalAssessment,
          },
        },
      },
      include: { InterviewFeedback: true },
    });

    if (!updated.InterviewFeedback) {
      throw new NotFoundError("Interview feedback was not persisted");
    }

    return updated.InterviewFeedback.id;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      handleError(
        new NotFoundError("Interview not found for this user"),
        "Failed to create interview feedback"
      );
    }
    handleError(error, "Failed to create interview feedback");
  }
}

export async function fetchFeedbackByInterviewId(
  interviewId: string
): Promise<InterviewFeedback | null> {
  try {
    const userId = await requireUserId();

    const feedback = await prisma.interviewFeedback.findFirst({
      where: { interviewId, interview: { userId } },
      include: feedbackInclude,
    });
    return feedback ? mapDbInterviewFeedback(feedback) : null;
  } catch (error) {
    handleError(error, "Failed to retrieve interview feedback");
  }
}
