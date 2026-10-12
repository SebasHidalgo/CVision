import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { handleError } from "@/lib/error/handleError";
import { STARTABLE_STATUSES, type TranscriptTurn } from "@/lib/elevenlabs/postCall";
import type { Interview, InterviewFeedback } from "@/types/interview";
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

/**
 * One interview per analysis, enforced by the unique on `resumeAnalysisId`.
 * Two submits racing past the action's read (two tabs, or the two CTAs on the
 * detail page) both get here; the loser hits the unique and is handed the
 * winner's id instead of an error.
 */
export async function createInterview(
  data: CreateInterviewData
): Promise<string> {
  let userId: string | undefined;
  try {
    userId = await requireUserId();

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
    if (
      userId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.interview.findFirst({
        where: { resumeAnalysisId: data.resumeId, userId },
        select: { id: true },
      });
      if (existing) return existing.id;
    }
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
        transcriptSource: null,
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
 * The legacy Vapi path: stores a transcript the browser supplied, marked as
 * such, and hands the interview to feedback generation. Owner-scoped and
 * guarded on the startable states, so a second submit changes nothing.
 * Removed in M3-C with the room that produces it.
 */
export async function storeClientTranscript(params: {
  interviewId: string;
  turns: TranscriptTurn[];
  recordingUrl?: string;
}): Promise<boolean> {
  try {
    const userId = await requireUserId();

    const result = await prisma.interview.updateMany({
      where: {
        id: params.interviewId,
        userId,
        status: { in: [...STARTABLE_STATUSES] },
      },
      data: {
        status: "FEEDBACK_PENDING",
        transcript: params.turns as Prisma.InputJsonValue,
        transcriptSource: "browser",
        endedAt: new Date(),
        failureReason: null,
        feedbackAttempts: 0,
        ...(params.recordingUrl ? { recordingUrl: params.recordingUrl } : {}),
      },
    });

    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to store client transcript");
  }
}

/**
 * Lets the owner retry feedback generation after it gave up. Only a FAILED
 * row whose failure was the generation itself qualifies: one that never got
 * a transcript has nothing to generate from.
 */
export async function reopenInterviewForFeedback(
  interviewId: string,
  feedbackFailureReason: string,
): Promise<boolean> {
  try {
    const userId = await requireUserId();

    const result = await prisma.interview.updateMany({
      where: {
        id: interviewId,
        userId,
        status: "FAILED",
        failureReason: feedbackFailureReason,
      },
      data: { status: "FEEDBACK_PENDING", feedbackAttempts: 0, failureReason: null },
    });

    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to reopen interview for feedback");
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
