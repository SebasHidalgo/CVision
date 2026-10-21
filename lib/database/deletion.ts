import "server-only";

import { Prisma, type InterviewStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { AnalysisBusyError } from "@/lib/error/errors";
import { handleError } from "@/lib/error/handleError";

/**
 * Data access for deleting an analysis or an account. Two callers: the
 * delete action, which resolved the session and passes its own user id, and
 * the Clerk webhook, which has no session and passes the id the signed
 * delivery named. Every write is scoped by that id, so neither path can
 * reach another account's rows.
 */

/** Rows the foreign keys remove with the analysis: its feedback, its interviews, their feedback. */
export const BUSY_INTERVIEW_STATUSES: ReadonlySet<InterviewStatus> = new Set(["IN_PROGRESS", "GENERATING"]);

export type DeletedAnalysis =
  /** No such analysis for this user. */
  | { deleted: false }
  /** Gone, with what the outside world still holds of it. */
  | { deleted: true; resumeKey: string; conversationIds: string[] };

const RACE_CODES = new Set(["P2034"]);
const DELETE_ATTEMPTS = 2;

/**
 * Deletes one analysis of one user, with its rehearsals and feedback (the
 * foreign keys cascade). Refuses, unless told the account is gone, while a
 * rehearsal is in a call or being scored: a paid call must not lose its
 * analysis under it. The check and the delete share a serializable
 * transaction, so a session issued in between cannot slip through. The
 * storage key and every conversation id are read before the rows go, for
 * the caller to clean up outside the database.
 */
export async function deleteAnalysisRows(params: {
  analysisId: string;
  userId: string;
  allowBusy: boolean;
}): Promise<DeletedAnalysis> {
  try {
    for (let round = 0; round < DELETE_ATTEMPTS; round += 1) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const row = await tx.resumeAnalysis.findFirst({
              where: { id: params.analysisId, userId: params.userId },
              select: {
                resumeKey: true,
                interviews: { select: { status: true, issuedConversationIds: true } },
              },
            });
            if (!row) return { deleted: false as const };

            if (!params.allowBusy && row.interviews.some((i) => BUSY_INTERVIEW_STATUSES.has(i.status))) {
              throw new AnalysisBusyError();
            }

            const removed = await tx.resumeAnalysis.deleteMany({
              where: { id: params.analysisId, userId: params.userId },
            });
            if (removed.count === 0) return { deleted: false as const };

            return {
              deleted: true as const,
              resumeKey: row.resumeKey,
              conversationIds: row.interviews.flatMap((i) => i.issuedConversationIds),
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const raced =
          error instanceof Prisma.PrismaClientKnownRequestError && RACE_CODES.has(error.code);
        if (!raced || round === DELETE_ATTEMPTS - 1) throw error;
      }
    }
    throw new Error("unreachable");
  } catch (error) {
    handleError(error, `Failed to delete the analysis rows (analysis=${params.analysisId}, user=${params.userId})`);
  }
}

/** Every analysis of the account, for the account deletion to walk. */
export async function listAnalysisIdsOfUser(userId: string): Promise<string[]> {
  try {
    const rows = await prisma.resumeAnalysis.findMany({ where: { userId }, select: { id: true } });
    return rows.map((row) => row.id);
  } catch (error) {
    handleError(error, `Failed to list the analyses of the user (user=${userId})`);
  }
}

/**
 * Conversation ids of the account's interviews that hang from no analysis.
 * The user row's cascade deletes those interviews; their conversations on
 * the platform are read first so they can be deleted too.
 */
export async function collectDetachedConversationIds(userId: string): Promise<string[]> {
  try {
    const rows = await prisma.interview.findMany({
      where: { userId, resumeAnalysisId: null },
      select: { issuedConversationIds: true },
    });
    return rows.flatMap((row) => row.issuedConversationIds);
  } catch (error) {
    handleError(error, `Failed to collect the detached conversation ids (user=${userId})`);
  }
}
