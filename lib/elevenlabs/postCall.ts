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
    })
    .nullish(),
  conversation_initiation_client_data: z
    .looseObject({
      dynamic_variables: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
});

export type PostCallTranscription = z.infer<typeof postCallTranscriptionSchema>;

/** `failureReason` when the candidate never spoke. */
export const NO_CANDIDATE_TURNS = "NO_CANDIDATE_TURNS";

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

  return {
    kind: "store",
    status: spoke ? "FEEDBACK_PENDING" : attemptsLeft ? "IN_PROGRESS" : "FAILED",
    failureReason: spoke ? null : NO_CANDIDATE_TURNS,
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
