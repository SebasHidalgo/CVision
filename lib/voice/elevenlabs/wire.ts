import { z } from "zod";
import type { CallRecord } from "@/lib/voice/postCall";

/**
 * ElevenLabs' own shapes, and their translation into the app's `CallRecord`.
 * The only place that names the webhook's and the conversations API's fields.
 */

/** One turn as the platform sends it; extra keys are dropped at the border. */
const wireTurnSchema = z.looseObject({
  role: z.string(),
  message: z.string().nullish(),
  time_in_call_secs: z.number().nullish(),
});

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
  transcript: z.array(wireTurnSchema),
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
 * The API record as the webhook would have delivered it, so one translation
 * serves both. What the webhook has that the API lacks is only the envelope's
 * `event_timestamp`, which the store falls back from.
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

/**
 * The platform's termination reason in the app's terms. Seen live: "end_call
 * tool was called." when the interviewer hangs up and "Client disconnected:
 * 1005" for End, a closed tab and a lost connection alike.
 */
function endedBy(reason: string | null | undefined): CallRecord["endedBy"] {
  const text = (reason ?? "").toLowerCase();
  if (text.includes("end_call")) return "agent";
  if (/max(imum)?[ _]?(conversation[ _])?duration|duration (limit|exceeded)|time limit/.test(text)) return "limit";
  if (text.includes("client")) return "client";
  return "unknown";
}

/** The platform's payload in the app's terms. The turns keep the stored shape, verbatim. */
export function toCallRecord(data: PostCallTranscription): CallRecord {
  const error = data.metadata?.error;
  return {
    conversationId: data.conversation_id,
    agentId: data.agent_id ?? null,
    failed: data.status === "failed",
    failure: error ? { code: error.code ?? null, reason: error.reason ?? null } : null,
    turns: data.transcript,
    startTimeSeconds: data.metadata?.start_time_unix_secs ?? null,
    durationSeconds: data.metadata?.call_duration_secs ?? null,
    variables: data.conversation_initiation_client_data?.dynamic_variables ?? null,
    endedBy: endedBy(data.metadata?.termination_reason),
  };
}
