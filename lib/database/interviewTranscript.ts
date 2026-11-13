import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { INTERVIEW_TIERS } from "@/lib/plans";
import { readCallEnd } from "@/lib/voice/callEnd";
import { readSegments, RESUME_WINDOW_MS } from "@/lib/voice/segments";
import {
  AT_CAPACITY,
  CALL_FAILED,
  callOverrunSeconds,
  decidePostCallOutcome,
  interviewIdFromRecord,
  NO_CANDIDATE_TURNS,
  STARTABLE_STATUSES,
  type CallRecord,
} from "@/lib/voice/postCall";
import { handleError } from "@/lib/error/handleError";
import { refundUsageIn } from "./usage";

/**
 * Data access for the post-call webhook, and nothing else. There is no
 * session: the caller is the voice provider, authenticated by the signature the route
 * verified before calling this. Rows are found by the conversation id the
 * server itself issued, never by anything that names a user, and the only
 * write is the one the payload describes, plus the refund of the usage unit
 * when the interview ends without a candidate ever speaking.
 */

const postCallSelect = {
  id: true,
  userId: true,
  callAllowedSeconds: true,
  status: true,
  conversationId: true,
  issuedConversationIds: true,
  transcript: true,
  issuedContext: true,
  startCount: true,
  usageEventId: true,
  tier: true,
  segments: true,
  finishRequestedAt: true,
  resumableUntil: true,
  callEnd: true,
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
  data: CallRecord;
  eventTimestamp: number | null | undefined;
  /** "elevenlabs" for the signed webhook, "elevenlabs-api" for the reconcile fetch. */
  source?: TranscriptSource;
}): Promise<StoreTranscriptResult> {
  try {
    const row = await findRow(data);
    if (!row) return { outcome: "unmatched" };

    const now = new Date();
    const outcome = decidePostCallOutcome({
      row: { ...row, segments: readSegments(row.segments), callEnd: readCallEnd(row.callEnd) },
      data,
      eventTimestamp,
      maxStarts: MAX_INTERVIEW_STARTS,
      plannedSeconds: INTERVIEW_TIERS[row.tier ?? "FULL"].seconds,
      now,
    });
    if (outcome.kind === "duplicate") return { outcome: "duplicate", interviewId: row.id };

    // An earlier call's record, late: kept beside the live one. The window opens so the
    // interview is scored even if the newer call never leaves a record.
    if (outcome.kind === "segment") {
      const kept = await prisma.interview.updateMany({
        where: { id: row.id, status: "IN_PROGRESS", conversationId: row.conversationId },
        data: {
          segments: outcome.segments as Prisma.InputJsonValue,
          ...(row.resumableUntil ? {} : { resumableUntil: new Date(now.getTime() + RESUME_WINDOW_MS) }),
        },
      });
      return kept.count === 1 ? { outcome: "stored", interviewId: row.id, status: "IN_PROGRESS" } : { outcome: "duplicate", interviewId: row.id };
    }

    // Two concurrent deliveries of the same call (the webhook and the API fetch) write once:
    // the second finds the row past the startable states, or its transcript already stored.
    // Times only when the delivery carries them: a payload without metadata
    // must not blank what the room reported.
    // A start the platform could not run is given back in the same write,
    // and only once: the second delivery of the same failed call is a
    // duplicate by the transcript check above.
    const updated = await prisma.interview.updateMany({
      where: { id: row.id, status: { in: [...STARTABLE_STATUSES] }, transcriptSource: null, ...(outcome.startRefunded ? { startCount: { gt: 0 } } : {}) },
      data: {
        status: outcome.status,
        conversationId: data.conversationId,
        transcript: outcome.transcript as Prisma.InputJsonValue,
        transcriptSource: source,
        failureReason: outcome.failureReason,
        contextMismatch: outcome.contextMismatch,
        resumableUntil: outcome.resumableUntil,
        ...(outcome.callEnd ? { callEnd: outcome.callEnd as Prisma.InputJsonValue } : {}),
        ...(outcome.segments ? { segments: outcome.segments as Prisma.InputJsonValue } : {}),
        ...(outcome.startedAt ? { startedAt: outcome.startedAt } : {}),
        ...(outcome.endedAt ? { endedAt: outcome.endedAt } : {}),
        ...(outcome.durationSeconds !== null ? { durationSeconds: outcome.durationSeconds } : {}),
        ...(outcome.startRefunded ? { startCount: { decrement: 1 } } : {}),
      },
    });

    if (updated.count === 0) return { outcome: "duplicate", interviewId: row.id };
    if (outcome.callEnd) {
      // Ids, the reason and the two clocks; the interviewer's own wording stays in the row.
      const room = outcome.callEnd.roomSeconds;
      console.info(
        `[CVision][voice] call end interview=${row.id} conversation=${data.conversationId} reason=${outcome.callEnd.reason}${outcome.callEnd.reason === "interviewer" && outcome.callEnd.detail ? `/${outcome.callEnd.detail}` : ""} platform=${data.durationSeconds ?? "?"}s room=${typeof room === "number" ? `${room}s` : "?"} status=${outcome.status} backup=${data.backupTurns ?? 0}${data.backupModels?.length ? ` (${data.backupModels.join(", ")})` : ""}${outcome.earlyEnd ? " EARLY END: resumable, start given back" : ""}`,
      );
    }

    // Nothing was heard in any call (the candidate never spoke, or the
    // platform could not run the call): the unit goes back, whatever paid
    // for it (a period interview, a credit, the trial), the moment the
    // transcript says so. With starts left the interview stays startable,
    // so the row forgets the reservation and the next start reserves again,
    // on the facts of that moment; only the latest session's transcript may
    // do this (a late delivery from an earlier call must not release a live
    // call's unit). With no start left the interview is FAILED and the
    // reservation stays on the row, refunded, for support to read. An
    // interview in which the candidate spoke keeps its unit: it is scored.
    const latestSession = data.conversationId === row.conversationId;
    // Only the latest call's allowance is on the row; an earlier call's late record is not judged.
    const overrun = latestSession ? callOverrunSeconds(row.callAllowedSeconds, data.durationSeconds) : 0;
    if (overrun > 0) await recordCallOverrun({ userId: row.userId, interviewId: row.id, conversationId: data.conversationId, allowedSeconds: row.callAllowedSeconds, recordedSeconds: data.durationSeconds, overrun });
    const reason = outcome.failureReason;
    const unheard = reason === NO_CANDIDATE_TURNS || reason === CALL_FAILED || reason === AT_CAPACITY;
    if (!outcome.counted && unheard && row.usageEventId && (outcome.status === "FAILED" || latestSession)) {
      await releaseReservation(row.id, row.usageEventId, reason, { retryable: outcome.status !== "FAILED" });
    }
    return { outcome: "stored", interviewId: row.id, status: outcome.status };
  } catch (error) {
    handleError(error, "Failed to store conversation transcript");
  }
}

/** One error line and one more on the user's count for a call that ran past its allowance. Never throws. */
async function recordCallOverrun(params: { userId: string; interviewId: string; conversationId: string; allowedSeconds: number | null; recordedSeconds: number | null; overrun: number }): Promise<void> {
  try {
    const counted = await prisma.user.updateMany({ where: { id: params.userId }, data: { callOverruns: { increment: 1 } } });
    const total = counted.count === 1 ? ((await prisma.user.findUnique({ where: { id: params.userId }, select: { callOverruns: true } }))?.callOverruns ?? "?") : "?";
    console.error(
      `[CVision][voice] CALL OVERRUN user=${params.userId} interview=${params.interviewId} conversation=${params.conversationId} allowed=${params.allowedSeconds}s recorded=${params.recordedSeconds}s over=${params.overrun}s; overruns by this user: ${total}`,
    );
  } catch (error) {
    console.error(`[CVision][voice] CALL OVERRUN user=${params.userId} interview=${params.interviewId} over=${params.overrun}s (not counted):`, error);
  }
}

async function findRow(data: CallRecord) {
  const byConversation = await prisma.interview.findFirst({
    where: { issuedConversationIds: { has: data.conversationId } },
    select: postCallSelect,
  });
  if (byConversation) return byConversation;

  const interviewId = interviewIdFromRecord(data);
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
        lastSessionAt: true,
        endedAt: true,
        startCount: true,
        usageEventId: true,
        segments: true,
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
