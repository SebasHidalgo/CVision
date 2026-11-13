import { z } from "zod";
import { END_INTERVIEW_TOOL, END_TOOL_REASONS, END_TOOL_REFUSED, type EndToolCall, type PlatformEnd } from "@/lib/voice/callEnd";
import { trimStoredTurns } from "@/lib/voice/transcript";
import type { CallRecord } from "@/lib/voice/postCall";

/**
 * ElevenLabs' own shapes, and their translation into the app's `CallRecord`.
 * The only place that names the webhook's and the conversations API's fields.
 */

/** One turn as the platform sends it: about 35 fields, of which the app reads these. */
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
  transcript: {
    role: string;
    message?: string | null;
    timeInCallSecs: number;
    toolCalls?: { toolName?: string | null; paramsAsJson?: string | null; requestId?: string | null }[] | null;
    toolResults?: { toolName?: string | null; resultValue?: string | null; requestId?: string | null }[] | null;
    llmOverride?: string | null;
  }[];
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
      // Kept in the webhook's spelling: the end tool and the backup model are read from here.
      ...(turn.toolCalls?.length ? { tool_calls: turn.toolCalls.map((call) => ({ tool_name: call.toolName ?? null, params_as_json: call.paramsAsJson ?? null, request_id: call.requestId ?? null })) } : {}),
      ...(turn.toolResults?.length ? { tool_results: turn.toolResults.map((result) => ({ tool_name: result.toolName ?? null, result_value: result.resultValue ?? null, request_id: result.requestId ?? null })) } : {}),
      ...(turn.llmOverride ? { llm_override: turn.llmOverride } : {}),
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
function endedBy(reason: string | null | undefined): PlatformEnd {
  const text = (reason ?? "").toLowerCase().trim();
  if (text.includes("end_call")) return "agent";
  if (/max(imum)?[ _]?(conversation[ _])?duration|duration (limit|exceeded)|time limit/.test(text)) return "limit";
  if (text.includes("client")) return "client";
  // Anything else the platform names is its own doing: a silence timeout, an error.
  return text ? "platform" : "unknown";
}

const toolCallSchema = z.looseObject({ tool_name: z.string().nullish(), params_as_json: z.string().nullish(), request_id: z.string().nullish() });
const toolResultSchema = z.looseObject({ tool_name: z.string().nullish(), result_value: z.string().nullish(), request_id: z.string().nullish() });

type WireTurn = PostCallTranscription["transcript"][number];
const toolCallsOf = (turn: WireTurn) => {
  const parsed = z.array(toolCallSchema).safeParse((turn as { tool_calls?: unknown }).tool_calls ?? []);
  return parsed.success ? parsed.data : [];
};
const toolResultsOf = (turn: WireTurn) => {
  const parsed = z.array(toolResultSchema).safeParse((turn as { tool_results?: unknown }).tool_results ?? []);
  return parsed.success ? parsed.data : [];
};

/** The last end_interview call of the record: what the interviewer asked for, and whether the room refused. */
function endToolCall(turns: WireTurn[]): EndToolCall | null {
  for (let index = turns.length - 1; index >= 0; index--) {
    const call = toolCallsOf(turns[index]).findLast((one) => one.tool_name === END_INTERVIEW_TOOL);
    if (!call) continue;
    let reason: unknown;
    try {
      reason = (JSON.parse(call.params_as_json ?? "{}") as { reason?: unknown }).reason;
    } catch {
      reason = null;
    }
    // The room always answers a refusal at once; a call it allowed ends the session, usually before any answer is recorded.
    const answer = turns
      .slice(index)
      .flatMap(toolResultsOf)
      .find((result) => (call.request_id ? result.request_id === call.request_id : result.tool_name === END_INTERVIEW_TOOL));
    return {
      reason: END_TOOL_REASONS.find((known) => known === reason) ?? "time_up",
      refused: (answer?.result_value ?? "").trimStart().startsWith(END_TOOL_REFUSED),
    };
  }
  return null;
}

/** A record entry as the backup count reads it; the server's webhook and the doctor's API read both map to this. */
export type BackupCountEntry = { role: string; llm_override?: unknown };

/** Turns the backup model answered: runs of agent entries the platform marks with the model it switched to. One rule for the server and the doctor. */
export function backupModelTurns(turns: BackupCountEntry[]): { count: number; models: string[] } {
  const models = new Set<string>();
  let count = 0;
  let inRun = false;
  for (const turn of turns) {
    const override = turn.llm_override;
    const flagged = turn.role === "agent" && typeof override === "string" && override.trim() !== "";
    if (flagged && !inRun) count += 1;
    if (flagged) models.add((override as string).trim());
    inRun = flagged;
  }
  return { count, models: [...models] };
}

/** The interviewer's turns: each stretch of agent entries between the candidate's lines. */
export function interviewerTurnCount(turns: BackupCountEntry[]): number {
  let count = 0;
  let inRun = false;
  for (const turn of turns) {
    const agent = turn.role === "agent";
    if (agent && !inRun) count += 1;
    inRun = agent;
  }
  return count;
}


/** The reason the interviewer gave the platform's old end_call tool, when it gave one. */
function endCallReason(turns: WireTurn[]): string | null {
  for (const turn of [...turns].reverse()) {
    const call = toolCallsOf(turn).find((one) => one.tool_name === "end_call");
    if (!call) continue;
    try {
      const reason = (JSON.parse(call.params_as_json ?? "{}") as { reason?: unknown }).reason;
      return typeof reason === "string" && reason.trim() ? reason.trim() : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** The platform's payload in the app's terms: the spoken turns, and what the tool turns said about the end. */
export function toCallRecord(data: PostCallTranscription): CallRecord {
  const error = data.metadata?.error;
  const backup = backupModelTurns(data.transcript);
  return {
    conversationId: data.conversation_id,
    agentId: data.agent_id ?? null,
    failed: data.status === "failed",
    failure: error ? { code: error.code ?? null, reason: error.reason ?? null } : null,
    // The three fields the app reads; the tool turns were read above and are not stored.
    turns: trimStoredTurns(data.transcript),
    startTimeSeconds: data.metadata?.start_time_unix_secs ?? null,
    durationSeconds: data.metadata?.call_duration_secs ?? null,
    variables: data.conversation_initiation_client_data?.dynamic_variables ?? null,
    endedBy: endedBy(data.metadata?.termination_reason),
    endCallReason: endCallReason(data.transcript),
    endTool: endToolCall(data.transcript),
    terminationReason: data.metadata?.termination_reason?.trim() || null,
    backupTurns: backup.count,
    backupModels: backup.models,
  };
}
