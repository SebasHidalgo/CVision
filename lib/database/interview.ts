import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { handleError } from "@/lib/error/handleError";
import { NotFoundError } from "@/lib/error/errors";
import { STARTABLE_STATUSES } from "@/lib/elevenlabs/postCall";
import type { Interview, InterviewFeedback } from "@/types/interview";
import type { FeedbackObject } from "@/lib/ai/schemas";
import {
  feedbackInclude,
  interviewOmit,
  isFinalized,
  mapDbInterview,
  mapDbInterviewFeedback,
} from "./mappers";

/**
 * The room needs the posting; the session endpoint also needs the parts of
 * the analysis the interviewer is briefed with. `feedback` is the raw Json
 * columns: the caller validates what it uses.
 */
const interviewDetailInclude = {
  resumeAnalysis: {
    select: {
      jobDescription: true,
      jobTitle: true,
      companyName: true,
      feedback: { select: { overall: true, jobFit: true } },
    },
  },
} satisfies Prisma.InterviewInclude;

type DbInterviewDetail = Prisma.InterviewGetPayload<{
  include: typeof interviewDetailInclude;
  omit: typeof interviewOmit;
}>;

export type InterviewWithResume = DbInterviewDetail & { finalized: boolean };

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

    const rows = await prisma.interview.findMany({
      where: { userId },
      omit: interviewOmit,
      orderBy: { createdAt: "desc" },
    });

    return rows.map(mapDbInterview);
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

    const row = await prisma.interview.findFirst({
      where: { id: interviewId, userId },
      include: interviewDetailInclude,
      omit: interviewOmit,
    });

    return row ? { ...row, finalized: isFinalized(row.status) } : null;
  } catch (error) {
    handleError(error, "Failed to retrieve interview record");
  }
}

export type ReserveInterviewSessionData = {
  interviewId: string;
  /** The dynamic variables issued for this session, as returned to the browser. */
  issuedContext: Record<string, string>;
  /** The conversation id ElevenLabs minted with the token. */
  conversationId: string;
  startedAt: Date;
  maxStarts: number;
};

/**
 * Records a session the server is about to hand out: stores the issued
 * context and conversation id, counts the start, and marks the interview in
 * progress. One guarded write, owner-scoped, with the state and the start
 * cap in the `where`: two tabs racing past the read-time checks cannot both
 * get through, and the loser learns it from `false`. Leftovers of a previous
 * attempt that produced no scoreable transcript are cleared.
 */
export async function reserveInterviewSession(
  data: ReserveInterviewSessionData
): Promise<boolean> {
  try {
    const userId = await requireUserId();

    const result = await prisma.interview.updateMany({
      where: {
        id: data.interviewId,
        userId,
        status: { in: [...STARTABLE_STATUSES] },
        startCount: { lt: data.maxStarts },
      },
      data: {
        status: "IN_PROGRESS",
        issuedContext: data.issuedContext,
        conversationId: data.conversationId,
        startedAt: data.startedAt,
        startCount: { increment: 1 },
        transcript: Prisma.DbNull,
        failureReason: null,
        contextMismatch: false,
        endedAt: null,
        durationSeconds: null,
      },
    });

    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to reserve interview session");
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
        status: "COMPLETED",
        // Legacy column, kept in step with `status` until M3-D drops it.
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
