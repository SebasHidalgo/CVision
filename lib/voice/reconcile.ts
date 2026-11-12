import "server-only";

import {
  claimReconcile,
  fetchInterviewForReconcile,
  markSessionLost,
  storeConversationTranscript,
  type StoreTranscriptResult,
} from "@/lib/database/interviewTranscript";
import { finalizeResumableInterview } from "@/lib/database/interviewResume";
import { MAX_INTERVIEW_DURATION_SECONDS, MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { readSegments } from "@/lib/voice/segments";
import { fetchConversation } from "@/lib/voice";
import {
  isStranded,
  platformFailure,
  RECONCILE_GRACE_SECONDS,
  RECONCILE_MIN_INTERVAL_MS,
  SESSION_LOST,
} from "@/lib/voice/postCall";

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

export type ReconcileOptions = {
  /**
   * How long after the room's end-of-call report the webhook is still
   * waited for. The default is the grace; 0 is the fast path for a call
   * that ended seconds after it started, where no webhook will come.
   */
  graceSeconds?: number;
  /** The caller knows the latest call is over (a new start, the room opening): ask now, whatever the window says. */
  callIsOver?: boolean;
  /** A start is not held back by a poll a few seconds earlier; starts have their own rate limit. */
  unthrottled?: boolean;
};

export async function reconcileStrandedInterview(
  interviewId: string,
  now = new Date(),
  { graceSeconds = RECONCILE_GRACE_SECONDS, callIsOver = false, unthrottled = false }: ReconcileOptions = {},
): Promise<ReconcileOutcome> {
  const row = await fetchInterviewForReconcile(interviewId);
  if (!row?.conversationId) return { kind: "not-stranded" };

  const stranded = callIsOver ? row.status === "IN_PROGRESS" && row.transcriptSource === null : isStranded(
    {
      status: row.status,
      conversationId: row.conversationId,
      hasTranscript: row.transcriptSource !== null,
      // The latest call's own start: a resumed interview began long before it.
      startedAt: row.lastSessionAt ?? row.startedAt,
      endedAt: row.endedAt,
    },
    now,
    MAX_INTERVIEW_DURATION_SECONDS,
    graceSeconds,
  );
  if (!stranded) return { kind: "not-stranded" };

  const claimed = await claimReconcile({ interviewId, now, minIntervalMs: unthrottled ? 0 : RECONCILE_MIN_INTERVAL_MS });
  if (!claimed) return { kind: "throttled" };

  const fetched = await fetchConversation(row.conversationId);

  if (fetched.kind === "in-progress") {
    console.info(`${LOG} interview=${interviewId} conversation still ${fetched.platformStatus} on the platform`);
    return { kind: "in-progress", platformStatus: fetched.platformStatus };
  }

  // The latest call left no record, but the candidate spoke in an earlier one: score those.
  if (fetched.kind === "not-found" && readSegments(row.segments).length > 0) {
    const result = await finalizeResumableInterview(interviewId, { latestMissing: true });
    console.warn(`${LOG} interview=${interviewId} latest call not found on the platform; earlier calls: ${result}`);
    return result === "finalized" ? { kind: "stored", result: { outcome: "stored", interviewId, status: "FEEDBACK_PENDING" } } : { kind: "lost" };
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
    data: fetched.record,
    eventTimestamp: null,
    source: "elevenlabs-api",
  });
  const failure = platformFailure(fetched.record);
  console.info(
    `${LOG} interview=${interviewId} fetched conversation=${fetched.record.conversationId} turns=${fetched.record.turns.length}: ${result.outcome}${result.outcome === "stored" ? ` ${result.status}` : ""}${failure ? ` (platform failed: ${failure})` : ""}`,
  );
  return { kind: "stored", result };
}

/** A session younger than this may still be connecting: its call has no record to ask for. */
export const UNREPORTED_CALL_MIN_AGE_MS = 15_000;

export type PreviousCallFacts = {
  status: string;
  conversationId: string | null;
  transcriptSource: string | null;
  endedAt: Date | null;
  lastSessionAt: Date | null;
};

/** The latest call has no record yet and is over as far as the server can tell: the room said so, or its session is not fresh. */
export function previousCallUnrecorded(facts: PreviousCallFacts, now: Date): boolean {
  if (facts.status !== "IN_PROGRESS" || !facts.conversationId || facts.transcriptSource !== null) return false;
  if (facts.endedAt) return true;
  return facts.lastSessionAt !== null && now.getTime() - facts.lastSessionAt.getTime() >= UNREPORTED_CALL_MIN_AGE_MS;
}

/** The platform closes a call's record a few seconds after the call ends: how often, and how long, a start waits for it. */
export const SETTLE_RETRY_MS = 1_500;
export const SETTLE_PATIENCE_MS = 8_000;

export type SettleOptions = {
  unthrottled?: boolean;
  /** A reconnect seconds after a drop: ask again while the platform is still closing the record. */
  patient?: boolean;
  now?: Date;
  wait?: (ms: number) => Promise<void>;
};

/** Fetches the previous call's record when it has not arrived, so time left and continuity are measured, not estimated. */
export async function settlePreviousCall(
  interviewId: string,
  facts: PreviousCallFacts,
  { unthrottled = false, patient = false, now = new Date(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: SettleOptions = {},
): Promise<boolean> {
  if (!previousCallUnrecorded(facts, now)) return false;
  try {
    let outcome = await reconcileStrandedInterview(interviewId, now, { callIsOver: true, unthrottled });
    // Only a call known to be over is waited for: one still live in another tab is not.
    const over = (found: ReconcileOutcome) => found.kind === "in-progress" && (facts.endedAt !== null || found.platformStatus === "processing");
    const began = Date.now();
    // Bounded twice: by the waits, and by the clock when the platform itself answers slowly.
    for (let waited = 0; patient && over(outcome) && waited + SETTLE_RETRY_MS <= SETTLE_PATIENCE_MS && Date.now() - began < SETTLE_PATIENCE_MS; waited += SETTLE_RETRY_MS) {
      await wait(SETTLE_RETRY_MS);
      outcome = await reconcileStrandedInterview(interviewId, new Date(now.getTime() + waited + SETTLE_RETRY_MS), { callIsOver: true, unthrottled: true });
    }
    if (outcome.kind !== "not-stranded" && outcome.kind !== "throttled") console.info(`${LOG} interview=${interviewId} previous call asked for before its record arrived: ${outcome.kind}`);
    return reconcileChangedRow(outcome);
  } catch (error) {
    console.warn(`${LOG} interview=${interviewId} could not fetch the previous call:`, error instanceof Error ? error.message : error);
    return false;
  }
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
