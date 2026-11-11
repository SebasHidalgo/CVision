import type { InterviewStatus } from "@prisma/client";
import { addSegment, mergeSegments, MIN_RESUME_SECONDS, RESUME_WINDOW_MS, segmentsSeconds, type CallSegment } from "./segments";
import { transcriptTurnSchema, type TranscriptTurn } from "./transcript";

/**
 * A finished call, and what to do with it. Pure: the adapter verifies and
 * parses, the data layer finds the row and writes, and the decision between
 * them lives here where a test can reach it.
 */

export { transcriptTurnSchema, type TranscriptTurn };

/**
 * One finished call as the app reads it, whoever the provider is: the adapter
 * builds it from a webhook delivery or from the provider API, the same way.
 */
export type CallRecord = {
  conversationId: string;
  agentId: string | null;
  /** The platform could not run the call (the agent never joined). */
  failed: boolean;
  /** The platform account of that failure, for the server log. */
  failure: { code: number | null; reason: string | null } | null;
  turns: TranscriptTurn[];
  startTimeSeconds: number | null;
  durationSeconds: number | null;
  /** The variables the browser handed the agent, when the record carries them. */
  variables: Record<string, unknown> | null;
  /**
   * Who ended the call, as the platform recorded it: the interviewer (its
   * end_call tool), the hard time limit, the client (End, a closed tab or a
   * lost connection look the same from there), or unknown.
   */
  endedBy: "agent" | "limit" | "client" | "unknown";
};

/** `failureReason` when the candidate never spoke. */
export const NO_CANDIDATE_TURNS = "NO_CANDIDATE_TURNS";
/** `failureReason` when the platform has no record of the latest session. */
export const SESSION_LOST = "SESSION_LOST";
/**
 * `failureReason` when the platform itself reports the call failed (its
 * status is "failed": the agent never joined, or the call broke before
 * anyone spoke). Not the candidate's microphone, and the feedback page
 * says so. Seen live when the ElevenLabs account ran out of credits: the
 * session token was issued, the room connected, and the platform dropped
 * the call at once with a conversation of zero turns.
 */
export const CALL_FAILED = "CALL_FAILED";
/**
 * `failureReason` when the platform refused the call for concurrency: every
 * interviewer was taken, or the wait in the queue ran out. Handled like
 * CALL_FAILED (the unit and the start go back) with its own, honest copy.
 */
export const AT_CAPACITY = "AT_CAPACITY";

/** The platform's refusal for concurrency: code 4300 ("at max capacity"), or a queue wait that ran out. */
export function refusedForCapacity(record: CallRecord): boolean {
  if (!record.failed || !record.failure) return false;
  return record.failure.code === 4300 || /max capacity|at capacity|queue/i.test(record.failure.reason ?? "");
}

/**
 * The platform's own account of a failed call, for the server log only:
 * the error code and reason it recorded (a quota, a misconfiguration, an
 * outage). Null unless the status is "failed".
 */
export function platformFailure(record: CallRecord): string | null {
  if (!record.failed) return null;
  const error = record.failure;
  if (!error) return "no reason given";
  const reason = (error.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return `code=${error.code ?? "-"}${reason ? ` ${reason}` : ""}`;
}

/**
 * How long after the call is known to be over a webhook is still given a
 * chance before the server goes and fetches the conversation itself. The
 * owner's live runs measured about a minute between the end of the call and
 * the delivery.
 */
export const RECONCILE_GRACE_SECONDS = 2 * 60;

/**
 * The least time between two platform calls for one stranded interview.
 * Every poll of every open tab reaches the reconcile; without this, a
 * conversation the platform keeps processing would be fetched six times a
 * minute per tab.
 */
export const RECONCILE_MIN_INTERVAL_MS = 60_000;

/**
 * A call the room reports over within this long of its session being
 * issued never became an interview: the platform refused it (no credits, a
 * misconfigured agent) or the connection broke at once. No webhook comes
 * for a failed conversation, so the server fetches it right away instead of
 * waiting out the grace; the per-interview throttle still applies.
 */
export const EARLY_END_WINDOW_MS = 30_000;

export type StrandedCandidate = {
  status: InterviewStatus;
  conversationId: string | null;
  hasTranscript: boolean;
  startedAt: Date | null;
  /** The room's report of the end of the call, when it made one. */
  endedAt: Date | null;
};

/**
 * An interview whose latest call must be over and whose transcript never
 * arrived. When the room reported the end of the call, the window is the
 * grace from that moment. When it did not (the tab was closed mid-call), it
 * is the agent's hard limit plus the grace, counted from the session issue,
 * the latest the call could have ended. A grace of zero is the fast path
 * for a call that ended seconds after it started: stranded as soon as the
 * room has reported the end.
 */
export function isStranded(
  row: StrandedCandidate,
  now: Date,
  maxDurationSeconds: number,
  graceSeconds: number = RECONCILE_GRACE_SECONDS,
): boolean {
  if (row.status !== "IN_PROGRESS") return false;
  if (!row.conversationId || row.hasTranscript || !row.startedAt) return false;
  const graceMs = graceSeconds * 1000;
  if (row.endedAt) return now.getTime() - row.endedAt.getTime() >= graceMs;
  return now.getTime() - row.startedAt.getTime() > maxDurationSeconds * 1000 + graceMs;
}

/** The dynamic variable the session endpoint issues so a payload can be matched without a conversation id. */
export const INTERVIEW_ID_VARIABLE = "interview_id";

/** States in which a session may still be issued. A stored transcript does not end these: see `decidePostCallOutcome`. */
export const STARTABLE_STATUSES: ReadonlySet<InterviewStatus> = new Set([
  "SCHEDULED",
  "IN_PROGRESS",
]);

export function hasCandidateTurns(turns: TranscriptTurn[]): boolean {
  return turns.some(
    (turn) => turn.role === "user" && typeof turn.message === "string" && turn.message.trim() !== "",
  );
}

/** The `interview_id` the browser passed, if the payload carries initiation data. */
export function interviewIdFromRecord(record: CallRecord): string | null {
  const value = record.variables?.[INTERVIEW_ID_VARIABLE];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Whether the variables the browser handed the agent are the ones the server
 * issued. `null` when the payload carries no initiation data, so nothing can
 * be said. Keys the platform adds (`system__*`) are ignored; any other extra
 * key is the client's doing and counts as a mismatch.
 */
export function initiationDataMatches(
  issued: Record<string, string>,
  received: Record<string, unknown> | null | undefined,
): boolean | null {
  if (!received) return null;

  for (const [key, value] of Object.entries(issued)) {
    if (received[key] !== value) return false;
  }
  for (const key of Object.keys(received)) {
    if (!key.startsWith("system__") && !(key in issued)) return false;
  }
  return true;
}

export type PostCallRow = {
  status: InterviewStatus;
  conversationId: string | null;
  transcript: unknown;
  issuedContext: unknown;
  startCount: number;
  /** Earlier calls of the interview that counted; none for a first call. */
  segments?: CallSegment[];
  /** The candidate asked to finish (End, or "Finish and get feedback"). */
  finishRequestedAt?: Date | null;
  resumableUntil?: Date | null;
};

export type PostCallOutcome =
  | { kind: "duplicate" }
  /** The record of an earlier call, delivered after a newer session was issued: kept, nothing else changes. */
  | { kind: "segment"; segments: CallSegment[] }
  | {
      kind: "store";
      status: Extract<InterviewStatus, "FEEDBACK_PENDING" | "IN_PROGRESS" | "FAILED">;
      failureReason: string | null;
      contextMismatch: boolean;
      startedAt: Date | null;
      endedAt: Date | null;
      durationSeconds: number | null;
      /**
       * The start this call counted is given back: the platform could not
       * run the call, and the cap of starts exists for the candidate's
       * microphone and connection, not for the platform's outages.
       */
      startRefunded: boolean;
      /** What the row's transcript holds after this write: this call, or every call merged when final. */
      transcript: TranscriptTurn[];
      /** The earlier calls to store; null leaves the column as it is. */
      segments: CallSegment[] | null;
      /** Set while a dropped interview may still be resumed; null otherwise. */
      resumableUntil: Date | null;
      /** The candidate spoke in some call of the interview: the unit stays spent. */
      counted: boolean;
    };

/** A recorded call as a segment. */
export function toSegment(record: Pick<CallRecord, "conversationId" | "turns" | "durationSeconds" | "startTimeSeconds">): CallSegment {
  return {
    conversationId: record.conversationId,
    turns: record.turns,
    durationSeconds: Math.max(0, record.durationSeconds ?? 0),
    startTimeSeconds: record.startTimeSeconds,
  };
}

/**
 * What a verified, matched record does to its row.
 *
 * - A call already stored, or a row past the startable states, is a retry
 *   or a stale delivery: do nothing.
 * - The record of an earlier call arriving after a newer session was
 *   issued: kept as a segment when the candidate spoke in it.
 * - Nobody has spoken in any call (the mic never worked, they hung up at
 *   the greeting): store the turns as evidence, record why, and leave the
 *   interview startable while starts remain; with none left it fails. When
 *   the platform reports the call failed (the agent never joined, or every
 *   interviewer was busy), the start is given back too.
 * - The candidate has spoken, in this call or an earlier one. How the call
 *   ended decides: the interviewer's end_call, the time limit, the
 *   candidate's request to finish, the interview length used up, the last
 *   start, or a resume window already over make it final, and every call
 *   is merged for the feedback. Anything else (a lost connection, a closed
 *   tab) leaves it resumable for `RESUME_WINDOW_MS`.
 */
export function decidePostCallOutcome({
  row,
  data,
  eventTimestamp,
  maxStarts,
  plannedSeconds = Number.POSITIVE_INFINITY,
  now = new Date(),
}: {
  row: PostCallRow;
  data: CallRecord;
  eventTimestamp: number | null | undefined;
  maxStarts: number;
  /** The interview length of the tier; every call together may not exceed it. */
  plannedSeconds?: number;
  now?: Date;
}): PostCallOutcome {
  const earlier = row.segments ?? [];
  if (earlier.some((segment) => segment.conversationId === data.conversationId)) return { kind: "duplicate" };
  const latest = row.conversationId === data.conversationId;
  if (latest && row.transcript !== null) return { kind: "duplicate" };
  if (!STARTABLE_STATUSES.has(row.status)) return { kind: "duplicate" };

  const spoke = hasCandidateTurns(data.turns);
  // The row has moved on to a newer session: this is an earlier call's record, late.
  if (!latest && row.conversationId !== null) {
    return spoke ? { kind: "segment", segments: addSegment(earlier, toSegment(data)) } : { kind: "duplicate" };
  }

  const attemptsLeft = row.startCount < maxStarts;

  const issued = isStringRecord(row.issuedContext) ? row.issuedContext : null;
  const received = data.variables;
  const matches = issued ? initiationDataMatches(issued, received) : null;

  const startSecs = data.startTimeSeconds;
  const durationSecs = data.durationSeconds;
  const startedAt = startSecs !== null ? new Date(startSecs * 1000) : null;
  const endedAt =
    startedAt && durationSecs !== null
      ? new Date(startedAt.getTime() + durationSecs * 1000)
      : typeof eventTimestamp === "number"
        ? new Date(eventTimestamp * 1000)
        : null;

  const failed = data.failed;
  const platformFailed = !spoke && failed;
  const base = {
    kind: "store" as const,
    contextMismatch: matches === false,
    endedAt,
    startRefunded: platformFailed,
  };

  // Nobody has spoken in any call of this interview.
  if (!spoke && earlier.length === 0) {
    return {
      ...base,
      status: platformFailed || attemptsLeft ? "IN_PROGRESS" : "FAILED",
      failureReason: failed ? (refusedForCapacity(data) ? AT_CAPACITY : CALL_FAILED) : NO_CANDIDATE_TURNS,
      startedAt,
      durationSeconds: durationSecs !== null ? Math.round(durationSecs) : null,
      transcript: data.turns,
      segments: null,
      resumableUntil: null,
      counted: false,
    };
  }

  // The interview counts, and so does every call of it the platform ran: a resumed call in
  // which the candidate said nothing is still part of what happened. A failed one is not.
  const all = platformFailed ? earlier : addSegment(earlier, toSegment(data));
  const used = segmentsSeconds(all);
  const callEnd = endedAt ?? now;
  const windowOver = callEnd.getTime() + RESUME_WINDOW_MS <= now.getTime();
  const final =
    !platformFailed &&
    (data.endedBy === "agent" ||
      data.endedBy === "limit" ||
      Boolean(row.finishRequestedAt) ||
      used >= plannedSeconds - MIN_RESUME_SECONDS ||
      !attemptsLeft ||
      windowOver);

  if (final) {
    return {
      ...base,
      status: "FEEDBACK_PENDING",
      failureReason: null,
      // The interview began with its first call.
      startedAt: earlier.length === 0 ? startedAt : null,
      durationSeconds: Math.round(used),
      transcript: mergeSegments(all),
      segments: all.length > 1 ? all : null,
      resumableUntil: null,
      counted: true,
    };
  }

  return {
    ...base,
    status: "IN_PROGRESS",
    failureReason: null,
    startedAt: earlier.length === 0 ? startedAt : null,
    durationSeconds: durationSecs !== null ? Math.round(durationSecs) : null,
    transcript: data.turns,
    segments: null,
    resumableUntil: row.resumableUntil ?? new Date(callEnd.getTime() + RESUME_WINDOW_MS),
    counted: true,
  };
}

/**
 * The row of a resumable interview made final without a new record: the
 * resume window lapsed, or the candidate asked to finish after the latest
 * call was already stored. Null when there is nothing to score.
 */
export function finalizeFromStored({
  segments,
  latest,
}: {
  segments: CallSegment[];
  /** The latest call as the row holds it; null when its record never came. */
  latest: CallSegment | null;
}): { transcript: TranscriptTurn[]; durationSeconds: number; segments: CallSegment[] | null } | null {
  // The latest call belongs once the interview counts: when the candidate spoke in it, or in an earlier one.
  const all = latest && latest.turns.length > 0 && (segments.length > 0 || hasCandidateTurns(latest.turns)) ? addSegment(segments, latest) : segments;
  if (all.length === 0) return null;
  return { transcript: mergeSegments(all), durationSeconds: Math.round(segmentsSeconds(all)), segments: all.length > 1 ? all : null };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
