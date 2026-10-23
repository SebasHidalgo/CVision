import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { MAX_INTERVIEW_STARTS } from "@/lib/elevenlabs/agentConfig";
import {
  CALL_FAILED,
  decidePostCallOutcome,
  interviewIdFromPayload,
  NO_CANDIDATE_TURNS,
  STARTABLE_STATUSES,
  type PostCallTranscription,
} from "@/lib/elevenlabs/postCall";
import { handleError } from "@/lib/error/handleError";
import { refundUsageIn } from "./usage";

/**
 * Data access for the post-call webhook, and nothing else. There is no
 * session: the caller is ElevenLabs, authenticated by the signature the route
 * verified before calling this. Rows are found by the conversation id the
 * server itself issued, never by anything that names a user, and the only
 * write is the one the payload describes, plus the refund of the usage unit
 * when the interview ends without a candidate ever speaking.
 */

const postCallSelect = {
  id: true,
  status: true,
  conversationId: true,
  issuedConversationIds: true,
  transcript: true,
  issuedContext: true,
  startCount: true,
  usageEventId: true,
} satisfies Prisma.InterviewSelect;

export type StoreTranscriptResult =
  | { outcome: "stored"; interviewId: string; status: string }
  | { outcome: "duplicate"; interviewId: string }
  | { outcome: "unmatched" };

/**
 * Matches the payload to its interview and stores it according to
 * `decidePostCallOutcome`. The conversation id is the key: the session
 * endpoint recorded every id it issued, and a delivery matches the row whose
 * list contains it. The `interview_id` variable is only a fallback, and only
 * for a row that was never issued a session, so a variable the browser could
 * alter cannot land a transcript on an interview that has its own sessions.
 * The same path serves the webhook and the reconcile fallback.
 */
export type TranscriptSource = "elevenlabs" | "elevenlabs-api";

export async function storeConversationTranscript({
  data,
  eventTimestamp,
  source = "elevenlabs",
}: {
  data: PostCallTranscription;
  eventTimestamp: number | null | undefined;
  /** "elevenlabs" for the signed webhook, "elevenlabs-api" for the reconcile fetch. */
  source?: TranscriptSource;
}): Promise<StoreTranscriptResult> {
  try {
    const row = await findRow(data);
    if (!row) return { outcome: "unmatched" };

    const outcome = decidePostCallOutcome({
      row,
      data,
      eventTimestamp,
      maxStarts: MAX_INTERVIEW_STARTS,
    });
    if (outcome.kind === "duplicate") return { outcome: "duplicate", interviewId: row.id };

    // The state guard makes two concurrent deliveries of the same event
    // idempotent: the second finds the row already past the startable states
    // and writes nothing.
    // Times only when the delivery carries them: a payload without metadata
    // must not blank what the room reported.
    // A start the platform could not run is given back in the same write,
    // and only once: the second delivery of the same failed call is a
    // duplicate by the transcript check above.
    const updated = await prisma.interview.updateMany({
      where: { id: row.id, status: { in: [...STARTABLE_STATUSES] }, ...(outcome.startRefunded ? { startCount: { gt: 0 } } : {}) },
      data: {
        status: outcome.status,
        conversationId: data.conversation_id,
        transcript: data.transcript as Prisma.InputJsonValue,
        transcriptSource: source,
        failureReason: outcome.failureReason,
        contextMismatch: outcome.contextMismatch,
        ...(outcome.startedAt ? { startedAt: outcome.startedAt } : {}),
        ...(outcome.endedAt ? { endedAt: outcome.endedAt } : {}),
        ...(outcome.durationSeconds !== null ? { durationSeconds: outcome.durationSeconds } : {}),
        ...(outcome.startRefunded ? { startCount: { decrement: 1 } } : {}),
      },
    });

    if (updated.count === 0) return { outcome: "duplicate", interviewId: row.id };

    // Nothing was heard (the candidate never spoke, or the platform could
    // not run the call): the unit goes back, whatever paid for it (a period
    // interview, a credit, the trial), the moment the transcript says so.
    // With starts left the interview stays startable, so the row forgets
    // the reservation and the next start reserves again, on the facts of
    // that moment; only the latest session's transcript may do this (a late
    // delivery from an earlier call must not release a live call's unit).
    // With no start left the interview is FAILED and the reservation stays
    // on the row, refunded, for support to read.
    const latestSession = data.conversation_id === row.conversationId;
    const reason = outcome.failureReason;
    if ((reason === NO_CANDIDATE_TURNS || reason === CALL_FAILED) && row.usageEventId && (outcome.status === "FAILED" || latestSession)) {
      await releaseReservation(row.id, row.usageEventId, reason, { retryable: outcome.status !== "FAILED" });
    }
    return { outcome: "stored", interviewId: row.id, status: outcome.status };
  } catch (error) {
    handleError(error, "Failed to store conversation transcript");
  }
}

async function findRow(data: PostCallTranscription) {
  const byConversation = await prisma.interview.findFirst({
    where: { issuedConversationIds: { has: data.conversation_id } },
    select: postCallSelect,
  });
  if (byConversation) return byConversation;

  const interviewId = interviewIdFromPayload(data);
  if (!interviewId) return null;

  return prisma.interview.findFirst({
    where: { id: interviewId, issuedConversationIds: { isEmpty: true } },
    select: postCallSelect,
  });
}

/** The columns the reconcile fallback decides on. No session: it runs from a poll. */
export async function fetchInterviewForReconcile(interviewId: string) {
  try {
    return await prisma.interview.findUnique({
      where: { id: interviewId },
      select: {
        id: true,
        status: true,
        conversationId: true,
        transcriptSource: true,
        startedAt: true,
        endedAt: true,
        startCount: true,
        usageEventId: true,
      },
    });
  } catch (error) {
    handleError(error, "Failed to read interview for reconciliation");
  }
}

/**
 * Takes the right to ask the platform about this interview now. One
 * conditional update: it succeeds only when the last check is older than
 * the interval (or there was none), so two tabs polling the same stranded
 * interview produce one platform call, and the loser learns it from false.
 */
export async function claimReconcile(params: {
  interviewId: string;
  now: Date;
  minIntervalMs: number;
}): Promise<boolean> {
  try {
    const result = await prisma.interview.updateMany({
      where: {
        id: params.interviewId,
        OR: [
          { reconcileCheckedAt: null },
          { reconcileCheckedAt: { lt: new Date(params.now.getTime() - params.minIntervalMs) } },
        ],
      },
      data: { reconcileCheckedAt: params.now },
    });
    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to claim the reconcile check");
  }
}

/**
 * The platform has no record of the latest session: the attempt is lost, but
 * not the interview while starts remain. The row stays startable with the
 * start already counted, and the reason tells the feedback page what to say.
 * With no start left the interview is FAILED and the usage unit reserved on
 * its first token goes back: nothing was ever heard. Guarded on the
 * conversation id so a webhook that lands in between is not overwritten.
 */
export async function markSessionLost(params: {
  interviewId: string;
  conversationId: string;
  reason: string;
  /** No start left: the interview ends here. */
  exhausted: boolean;
  usageEventId: string | null;
}): Promise<boolean> {
  try {
    const result = await prisma.interview.updateMany({
      where: {
        id: params.interviewId,
        status: { in: [...STARTABLE_STATUSES] },
        conversationId: params.conversationId,
        transcriptSource: null,
      },
      data: { failureReason: params.reason, ...(params.exhausted ? { status: "FAILED" } : {}) },
    });
    // Nothing was heard either way: the unit goes back now. With starts left
    // the row forgets the reservation so the next start reserves again.
    if (result.count === 1 && params.usageEventId) {
      await releaseReservation(params.interviewId, params.usageEventId, params.reason, { retryable: !params.exhausted });
    }
    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to mark interview session as lost");
  }
}

/**
 * Gives an interview's unit back, once, whatever paid for it: the refund is
 * by usage event id, so a period interview, a credit and the trial all
 * return the same way. When the interview may still be started, the row
 * forgets the reservation (the event keeps `refId` = the interview, and the
 * row keeps `paidBy`, so support can still tell), and the next session's
 * first token reserves again. A refunded reservation is never reserved
 * twice: the row's `usageEventId` guards the clear. The refund and the
 * clear are one transaction: a page read between them once showed the
 * credit as both returned and still pending.
 */
async function releaseReservation(interviewId: string, usageEventId: string, reason: string, { retryable }: { retryable: boolean }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await refundUsageIn(tx, usageEventId, reason);
    if (retryable) {
      await tx.interview.updateMany({ where: { id: interviewId, usageEventId }, data: { usageEventId: null } });
    }
  });
}
