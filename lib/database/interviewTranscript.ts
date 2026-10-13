import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { MAX_INTERVIEW_STARTS } from "@/lib/elevenlabs/agentConfig";
import {
  decidePostCallOutcome,
  interviewIdFromPayload,
  STARTABLE_STATUSES,
  type PostCallTranscription,
} from "@/lib/elevenlabs/postCall";
import { handleError } from "@/lib/error/handleError";

/**
 * Data access for the post-call webhook, and nothing else. There is no
 * session: the caller is ElevenLabs, authenticated by the signature the route
 * verified before calling this. Rows are found by the conversation id the
 * server itself issued, never by anything that names a user, and the only
 * write is the one the payload describes.
 */

const postCallSelect = {
  id: true,
  status: true,
  conversationId: true,
  issuedConversationIds: true,
  transcript: true,
  issuedContext: true,
  startCount: true,
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
    const updated = await prisma.interview.updateMany({
      where: { id: row.id, status: { in: [...STARTABLE_STATUSES] } },
      data: {
        status: outcome.status,
        conversationId: data.conversation_id,
        transcript: data.transcript as Prisma.InputJsonValue,
        transcriptSource: source,
        failureReason: outcome.failureReason,
        contextMismatch: outcome.contextMismatch,
        ...(outcome.startedAt ? { startedAt: outcome.startedAt } : {}),
        endedAt: outcome.endedAt,
        durationSeconds: outcome.durationSeconds,
      },
    });

    if (updated.count === 0) return { outcome: "duplicate", interviewId: row.id };
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
      },
    });
  } catch (error) {
    handleError(error, "Failed to read interview for reconciliation");
  }
}

/**
 * The platform has no record of the latest session: the attempt is lost, but
 * not the interview. The row stays startable with the start already counted,
 * and the reason tells the feedback page what to say. Guarded on the
 * conversation id so a webhook that lands in between is not overwritten.
 */
export async function markSessionLost(params: {
  interviewId: string;
  conversationId: string;
  reason: string;
}): Promise<boolean> {
  try {
    const result = await prisma.interview.updateMany({
      where: {
        id: params.interviewId,
        status: { in: [...STARTABLE_STATUSES] },
        conversationId: params.conversationId,
        transcriptSource: null,
      },
      data: { failureReason: params.reason },
    });
    return result.count === 1;
  } catch (error) {
    handleError(error, "Failed to mark interview session as lost");
  }
}
