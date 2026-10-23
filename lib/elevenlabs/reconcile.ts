import "server-only";

import {
  claimReconcile,
  fetchInterviewForReconcile,
  markSessionLost,
  storeConversationTranscript,
  type StoreTranscriptResult,
} from "@/lib/database/interviewTranscript";
import { MAX_INTERVIEW_DURATION_SECONDS, MAX_INTERVIEW_STARTS } from "@/lib/elevenlabs/agentConfig";
import { fetchConversation } from "@/lib/elevenlabs/client";
import {
  isStranded,
  platformFailure,
  RECONCILE_MIN_INTERVAL_MS,
  SESSION_LOST,
} from "@/lib/elevenlabs/postCall";

/**
 * The fallback for a webhook that never arrived. The webhook stays primary;
 * this runs only for an interview whose latest call must be over and whose
 * transcript is still missing, at most once a minute per interview, and it
 * goes through the exact storage path the webhook uses, so the outcome
 * (scored, silent, duplicate) is decided once, in one place.
 */

const LOG = "[CVision][reconcile]";

export type ReconcileOutcome =
  /** Not IN_PROGRESS, no session issued, a transcript already stored, or inside the window. */
  | { kind: "not-stranded" }
  /** Another check ran within the last minute: nothing asked, poll on. */
  | { kind: "throttled" }
  /** The platform still has the call open or is processing it: poll on. */
  | { kind: "in-progress"; platformStatus: string }
  /** The platform has no record of the session: the attempt is lost, the interview is not. */
  | { kind: "lost" }
  /** Fetched and handed to the webhook's storage path. */
  | { kind: "stored"; result: StoreTranscriptResult };

export async function reconcileStrandedInterview(
  interviewId: string,
  now = new Date(),
): Promise<ReconcileOutcome> {
  const row = await fetchInterviewForReconcile(interviewId);
  if (!row?.conversationId) return { kind: "not-stranded" };

  const stranded = isStranded(
    {
      status: row.status,
      conversationId: row.conversationId,
      hasTranscript: row.transcriptSource !== null,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    },
    now,
    MAX_INTERVIEW_DURATION_SECONDS,
  );
  if (!stranded) return { kind: "not-stranded" };

  const claimed = await claimReconcile({ interviewId, now, minIntervalMs: RECONCILE_MIN_INTERVAL_MS });
  if (!claimed) return { kind: "throttled" };

  const fetched = await fetchConversation(row.conversationId);

  if (fetched.kind === "in-progress") {
    console.info(`${LOG} interview=${interviewId} conversation still ${fetched.platformStatus} on the platform`);
    return { kind: "in-progress", platformStatus: fetched.platformStatus };
  }

  if (fetched.kind === "not-found") {
    const exhausted = row.startCount >= MAX_INTERVIEW_STARTS;
    await markSessionLost({
      interviewId,
      conversationId: row.conversationId,
      reason: SESSION_LOST,
      exhausted,
      usageEventId: row.usageEventId,
    });
    console.warn(
      `${LOG} interview=${interviewId} conversation not found on the platform: attempt marked lost${exhausted ? ", no start left, interview failed" : ""}`,
    );
    return { kind: "lost" };
  }

  const result = await storeConversationTranscript({
    data: fetched.data,
    eventTimestamp: null,
    source: "elevenlabs-api",
  });
  const failure = platformFailure(fetched.data);
  console.info(
    `${LOG} interview=${interviewId} fetched conversation=${fetched.data.conversation_id} turns=${fetched.data.transcript.length}: ${result.outcome}${result.outcome === "stored" ? ` ${result.status}` : ""}${failure ? ` (platform failed: ${failure})` : ""}`,
  );
  return { kind: "stored", result };
}

/** True when a reconcile outcome left a transcript that is ready to be scored. */
export function reconcileNeedsFeedback(outcome: ReconcileOutcome): boolean {
  return (
    outcome.kind === "stored" &&
    outcome.result.outcome === "stored" &&
    outcome.result.status === "FEEDBACK_PENDING"
  );
}

/** True when a reconcile outcome changed the row, so a caller should read it again. */
export function reconcileChangedRow(outcome: ReconcileOutcome): boolean {
  return outcome.kind === "stored" || outcome.kind === "lost";
}
