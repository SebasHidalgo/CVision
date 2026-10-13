import "server-only";

import { Prisma, type InterviewStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { InterviewAttemptLimitError } from "@/lib/error/errors";
import { handleError } from "@/lib/error/handleError";
import { z } from "zod";
import { STARTABLE_STATUSES, transcriptTurnSchema, type TranscriptTurn } from "@/lib/elevenlabs/postCall";
import { UNCOUNTED_ATTEMPT_STATUSES } from "@/lib/interviewLimits";
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
  /** The provisional cap on counted attempts per analysis. */
  maxAttempts: number;
};

export type CreateInterviewResult = {
  id: string;
  attemptNumber: number;
  /** False when a live attempt already existed and was returned instead. */
  created: boolean;
};

/** Racing creates surface as one of these; the loser reads again and finds the winner live. */
const RACE_CODES = new Set(["P2034", "P2002"]);
const CREATE_ATTEMPTS = 3;

/**
 * Starts the next rehearsal of an analysis, or hands back the one that is
 * still live. One live attempt (SCHEDULED or IN_PROGRESS) at a time, no more
 * counted attempts than the cap, and attempt numbers that never collide: the
 * checks and the numbered insert run in one serializable transaction, so two
 * submits racing past the action's read (two tabs, or the two CTAs on the
 * detail page) cannot both create. The loser's transaction fails to
 * serialize, or hits the unique on (analysis, attempt), and the retry finds
 * the winner, or the cap.
 */
export async function createInterview(
  data: CreateInterviewData
): Promise<CreateInterviewResult> {
  try {
    const userId = await requireUserId();

    for (let round = 0; round < CREATE_ATTEMPTS; round += 1) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const live = await tx.interview.findFirst({
              where: {
                resumeAnalysisId: data.resumeId,
                userId,
                status: { in: [...STARTABLE_STATUSES] },
              },
              select: { id: true, attemptNumber: true },
            });
            if (live) return { id: live.id, attemptNumber: live.attemptNumber, created: false };

            // Lost sessions and silent attempts (FAILED, EXPIRED) are not
            // rehearsals the candidate got; they do not use up the cap.
            const used = await tx.interview.count({
              where: {
                resumeAnalysisId: data.resumeId,
                status: { notIn: [...UNCOUNTED_ATTEMPT_STATUSES] as InterviewStatus[] },
              },
            });
            if (used >= data.maxAttempts) throw new InterviewAttemptLimitError();

            const last = await tx.interview.aggregate({
              where: { resumeAnalysisId: data.resumeId },
              _max: { attemptNumber: true },
            });
            const created = await tx.interview.create({
              data: {
                role: data.role,
                techstack: data.techstack,
                userId,
                resumeAnalysisId: data.resumeId,
                attemptNumber: (last._max.attemptNumber ?? 0) + 1,
              },
              select: { id: true, attemptNumber: true },
            });
            return { id: created.id, attemptNumber: created.attemptNumber, created: true };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const raced =
          error instanceof Prisma.PrismaClientKnownRequestError && RACE_CODES.has(error.code);
        if (!raced || round === CREATE_ATTEMPTS - 1) throw error;
      }
    }
    throw new Error("unreachable");
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
        issuedConversationIds: { push: data.conversationId },
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

const transcriptSchema = z.array(transcriptTurnSchema);

/**
 * The stored turns of one of the caller's interviews, for the feedback page
 * to show back. `null` when there is no transcript yet, when the row holds
 * something that is not a transcript, or when the interview is not theirs.
 */
export async function fetchInterviewTranscript(
  interviewId: string
): Promise<TranscriptTurn[] | null> {
  try {
    const userId = await requireUserId();

    const row = await prisma.interview.findFirst({
      where: { id: interviewId, userId },
      select: { transcript: true },
    });
    if (!row?.transcript) return null;

    const parsed = transcriptSchema.safeParse(row.transcript);
    if (!parsed.success) {
      console.warn(`[CVision] Interview ${interviewId} transcript is outside the schema`);
      return null;
    }
    return parsed.data;
  } catch (error) {
    handleError(error, "Failed to retrieve interview transcript");
  }
}

/** What the status endpoint answers, and what the feedback page polls for. */
export type InterviewStatusSnapshot = {
  status: InterviewStatus;
  hasFeedback: boolean;
  startCount: number;
  failureReason: string | null;
};

/**
 * The few columns a poll needs, owner-scoped. `transcriptSource` stands in
 * for "a transcript is stored": it is set with the transcript and cleared
 * when a new session is issued, and it is not tens of kilobytes.
 */
export async function fetchInterviewStatus(interviewId: string): Promise<
  | (InterviewStatusSnapshot & {
      id: string;
      conversationId: string | null;
      hasTranscript: boolean;
      startedAt: Date | null;
      endedAt: Date | null;
    })
  | null
> {
  try {
    const userId = await requireUserId();

    const row = await prisma.interview.findFirst({
      where: { id: interviewId, userId },
      select: {
        id: true,
        status: true,
        startCount: true,
        failureReason: true,
        conversationId: true,
        transcriptSource: true,
        startedAt: true,
        endedAt: true,
        InterviewFeedback: { select: { id: true } },
      },
    });
    if (!row) return null;

    return {
      id: row.id,
      status: row.status,
      hasFeedback: row.InterviewFeedback !== null,
      startCount: row.startCount,
      failureReason: row.failureReason,
      conversationId: row.conversationId,
      hasTranscript: row.transcriptSource !== null,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    };
  } catch (error) {
    handleError(error, "Failed to retrieve interview status");
  }
}

/**
 * The room's report that the call ended. A hint, not the record: it is
 * written only while the interview is still IN_PROGRESS with no end time, so
 * the platform's own values, when the transcript arrives, win over it. A new
 * session clears it again. False when nothing was written: already ended,
 * no longer in progress, or not the caller's.
 */
export async function markInterviewEnded(params: {
  interviewId: string;
  endedAt: Date;
}): Promise<boolean> {
  try {
    const userId = await requireUserId();

    const result = await prisma.interview.updateMany({
      where: { id: params.interviewId, userId, status: "IN_PROGRESS", endedAt: null },
      data: { endedAt: params.endedAt },
    });

    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to record the end of the interview");
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
