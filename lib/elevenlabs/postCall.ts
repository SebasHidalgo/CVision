import type { InterviewStatus } from "@prisma/client";
import { z } from "zod";

/**
 * The post-call transcription event, and what to do with it. Pure: the route
 * verifies and parses, the data layer finds the row and writes, and the
 * decision between them lives here where a test can reach it.
 */

/** One turn, kept loose on purpose: the row stores the array verbatim. */
export const transcriptTurnSchema = z.looseObject({
  role: z.string(),
  message: z.string().nullish(),
  time_in_call_secs: z.number().nullish(),
});

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

/** Any event: only the type is needed to route it. */
export const postCallEventSchema = z.looseObject({
  type: z.string(),
  event_timestamp: z.number().nullish(),
  data: z.unknown(),
});

export const POST_CALL_TRANSCRIPTION = "post_call_transcription";

/** The `data` of a `post_call_transcription` event, the parts that matter. */
export const postCallTranscriptionSchema = z.looseObject({
  agent_id: z.string().nullish(),
  conversation_id: z.string().min(1),
  status: z.string().nullish(),
  transcript: z.array(transcriptTurnSchema),
  metadata: z
    .looseObject({
      start_time_unix_secs: z.number().nullish(),
      call_duration_secs: z.number().nullish(),
      termination_reason: z.string().nullish(),
      /** Set when the platform could not run the call; `status` is then "failed". */
      error: z.looseObject({ code: z.number().nullish(), reason: z.string().nullish() }).nullish(),
    })
    .nullish(),
  conversation_initiation_client_data: z
    .looseObject({
      dynamic_variables: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
});

export type PostCallTranscription = z.infer<typeof postCallTranscriptionSchema>;

/**
 * What `GET /v1/convai/conversations/{id}` answers, structurally: the SDK's
 * camelCase model, reduced to the fields the webhook also carries.
 */
export type ConversationApiRecord = {
  agentId: string;
  conversationId: string;
  status: string;
  transcript: { role: string; message?: string | null; timeInCallSecs: number }[];
  metadata: {
    startTimeUnixSecs: number;
    callDurationSecs: number;
    terminationReason?: string | null;
    error?: { code: number; reason?: string | null } | null;
  };
  conversationInitiationClientData?: { dynamicVariables?: Record<string, unknown> | null } | null;
};

/** The platform's conversation statuses that mean the call is over. */
export const CONVERSATION_ENDED_STATUSES: ReadonlySet<string> = new Set(["done", "failed"]);

/**
 * The API record as the webhook would have delivered it, so one storage path
 * serves both. Field for field: role, message and time_in_call_secs per
 * turn; start, duration and termination reason in the metadata; the dynamic
 * variables the client sent. What the webhook has that the API lacks is only
 * the envelope's `event_timestamp`, which the store falls back from.
 */
export function fromConversationApi(record: ConversationApiRecord): PostCallTranscription {
  return {
    agent_id: record.agentId,
    conversation_id: record.conversationId,
    status: record.status,
    transcript: record.transcript.map((turn) => ({
      role: turn.role,
      message: turn.message ?? null,
      time_in_call_secs: turn.timeInCallSecs,
    })),
    metadata: {
      start_time_unix_secs: record.metadata.startTimeUnixSecs,
      call_duration_secs: record.metadata.callDurationSecs,
      termination_reason: record.metadata.terminationReason ?? null,
      ...(record.metadata.error ? { error: { code: record.metadata.error.code, reason: record.metadata.error.reason ?? null } } : {}),
    },
    conversation_initiation_client_data: record.conversationInitiationClientData
      ? { dynamic_variables: record.conversationInitiationClientData.dynamicVariables ?? null }
      : null,
  };
}

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
 * The platform's own account of a failed call, for the server log only:
 * the error code and reason it recorded (a quota, a misconfiguration, an
 * outage). Null unless the status is "failed".
 */
export function platformFailure(data: PostCallTranscription): string | null {
  if (data.status !== "failed") return null;
  const error = data.metadata?.error;
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
 * the latest the call could have ended.
 */
export function isStranded(
  row: StrandedCandidate,
  now: Date,
  maxDurationSeconds: number,
): boolean {
  if (row.status !== "IN_PROGRESS") return false;
  if (!row.conversationId || row.hasTranscript || !row.startedAt) return false;
  const graceMs = RECONCILE_GRACE_SECONDS * 1000;
  if (row.endedAt) return now.getTime() - row.endedAt.getTime() > graceMs;
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
export function interviewIdFromPayload(data: PostCallTranscription): string | null {
  const value = data.conversation_initiation_client_data?.dynamic_variables?.[INTERVIEW_ID_VARIABLE];
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
};

export type PostCallOutcome =
  | { kind: "duplicate" }
  | {
      kind: "store";
      status: Extract<InterviewStatus, "FEEDBACK_PENDING" | "IN_PROGRESS" | "FAILED">;
      failureReason: string | null;
      contextMismatch: boolean;
      startedAt: Date | null;
      endedAt: Date | null;
      durationSeconds: number | null;
    };

/**
 * What a verified, matched payload does to its row.
 *
 * - A row that already holds this conversation's transcript, or is past the
 *   startable states, is a retry or a stale delivery: do nothing.
 * - Candidate turns present: store and hand off to feedback generation.
 * - No candidate turns (the mic never worked, or they hung up at the greeting):
 *   store the turns as evidence, record why, and leave the interview
 *   startable while attempts remain. Only when the start cap is used up does
 *   the interview fail; otherwise a mic problem would consume the interview
 *   and the retries the cap exists to allow would be unreachable.
 * - No candidate turns and the platform reports the call failed (its
 *   status is "failed": the agent never joined): the same, under
 *   `CALL_FAILED`, so nobody is told to check a microphone that was fine.
 */
export function decidePostCallOutcome({
  row,
  data,
  eventTimestamp,
  maxStarts,
}: {
  row: PostCallRow;
  data: PostCallTranscription;
  eventTimestamp: number | null | undefined;
  maxStarts: number;
}): PostCallOutcome {
  const sameConversation = row.conversationId === data.conversation_id;
  if (sameConversation && row.transcript !== null) return { kind: "duplicate" };
  if (!STARTABLE_STATUSES.has(row.status)) return { kind: "duplicate" };

  const spoke = hasCandidateTurns(data.transcript);
  const attemptsLeft = row.startCount < maxStarts;

  const issued = isStringRecord(row.issuedContext) ? row.issuedContext : null;
  const received = data.conversation_initiation_client_data?.dynamic_variables;
  const matches = issued ? initiationDataMatches(issued, received) : null;

  const startSecs = data.metadata?.start_time_unix_secs ?? null;
  const durationSecs = data.metadata?.call_duration_secs ?? null;
  const startedAt = startSecs !== null ? new Date(startSecs * 1000) : null;
  const endedAt =
    startedAt && durationSecs !== null
      ? new Date(startedAt.getTime() + durationSecs * 1000)
      : typeof eventTimestamp === "number"
        ? new Date(eventTimestamp * 1000)
        : null;

  const failed = data.status === "failed";

  return {
    kind: "store",
    status: spoke ? "FEEDBACK_PENDING" : attemptsLeft ? "IN_PROGRESS" : "FAILED",
    failureReason: spoke ? null : failed ? CALL_FAILED : NO_CANDIDATE_TURNS,
    contextMismatch: matches === false,
    startedAt,
    endedAt,
    durationSeconds: durationSecs !== null ? Math.round(durationSecs) : null,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
