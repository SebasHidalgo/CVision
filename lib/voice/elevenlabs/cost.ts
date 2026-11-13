/**
 * What the platform charged for conversations, read from its own records,
 * and what the plan pays per credit. Raw REST on purpose: the charge fields
 * grow faster than the SDK's types (the voice surcharge is not in 2.71).
 * No server-only import: the cost script and the voice e2e spec load it.
 */

const API = "https://api.elevenlabs.io";

export type ConversationCost = {
  conversationId: string;
  agentId: string | null;
  status: string;
  startedAt: Date | null;
  durationSeconds: number;
  /** Turns the platform's record holds so far. */
  turns: number;
  /** Credits charged in total; null when the platform recorded none (a call that never ran). */
  credits: number | null;
  /** The split the platform reports, in credits, when it reports one. */
  callCredits: number | null;
  llmCredits: number | null;
  /** Voice Library surcharge in credits, charged on top of `credits`. */
  voiceSurchargeCredits: number | null;
  /** The platform's own dollar figure for the call, when present. */
  dollars: number | null;
  /** The plan the call was charged on ("free", "starter"…): rates differ by plan. */
  tier: string | null;
  /** Charged at the burst rate. */
  burst: boolean;
  /** Seconds held in the queue before the agent picked up (not billed). */
  queueSeconds: number | null;
  /** The language the platform detected in the call. */
  language: string | null;
  failure: string | null;
};

export type PlanPrice = {
  tier: string;
  /** Credits the plan includes per period. */
  credits: number;
  creditsUsed: number;
  /** What the next invoice charges for the period, in dollars; null when the API shows none. */
  dollars: number | null;
};

function requireKey(env: Record<string, string | undefined>): string {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set (see .env.template)");
  return apiKey;
}

async function get(path: string, env: Record<string, string | undefined>): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, { headers: { "xi-api-key": requireKey(env) }, signal: AbortSignal.timeout(20_000) });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = (body?.detail ?? {}) as { status?: string; message?: string };
    // The platform's own words name a missing permission; nothing in them is secret.
    throw new Error(`ElevenLabs answered HTTP ${response.status}${detail.status ? ` (${detail.status})` : ""}${detail.message ? `: ${detail.message}` : ""}`);
  }
  return body ?? {};
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);

/** One recorded turn in a line, for a script to print: when, who (and which model, when the backup answered), its first words, its tool calls and their results. */
export type RecordedTurnLine = { at: number | null; role: string; backupModel: string | null; said: string | null; tools: string[] };

/** How the platform recorded a call, turn by turn, with what the tools were asked and answered. Throws on any platform error. */
export async function readConversationTurns(conversationId: string, env: Record<string, string | undefined> = process.env): Promise<{ termination: string | null; turns: RecordedTurnLine[] }> {
  const record = await get(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`, env);
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
  return {
    termination: text(metadata.termination_reason),
    turns: list(record.transcript).map((turn) => ({
      at: number(turn.time_in_call_secs),
      role: text(turn.role) ?? "?",
      backupModel: text(turn.llm_override),
      said: text(turn.message)?.slice(0, 70) ?? null,
      tools: [
        ...list(turn.tool_calls).map((call) => `call ${text(call.tool_name) ?? "?"} (${text(call.type) ?? "?"}) ${text(call.params_as_json) ?? ""}`),
        ...list(turn.tool_results).map((result) => `result ${text(result.tool_name) ?? "?"} (${text(result.type) ?? "?"})${result.is_error === true ? " ERROR" : ""}: ${(text(result.result_value) ?? "").slice(0, 60)}`),
      ],
    })),
  };
}

/** One conversation's charge. Throws on any platform error; the caller prints it. */
export async function readConversationCost(conversationId: string, env: Record<string, string | undefined> = process.env): Promise<ConversationCost> {
  const record = await get(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`, env);
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const charging = (metadata.charging ?? {}) as Record<string, unknown>;
  const error = (metadata.error ?? null) as { reason?: unknown } | null;
  const started = number(metadata.start_time_unix_secs);
  return {
    conversationId: text(record.conversation_id) ?? conversationId,
    agentId: text(record.agent_id),
    status: text(record.status) ?? "unknown",
    startedAt: started ? new Date(started * 1000) : null,
    durationSeconds: number(metadata.call_duration_secs) ?? 0,
    turns: Array.isArray(record.transcript) ? record.transcript.length : 0,
    credits: number(metadata.cost),
    callCredits: number(charging.call_charge),
    llmCredits: number(charging.llm_charge),
    voiceSurchargeCredits: number(charging.voice_surcharge_charge),
    dollars: number(metadata.cost_fiat),
    tier: text(charging.tier),
    burst: charging.is_burst === true,
    queueSeconds: number(metadata.queue_wait_secs),
    language: text(metadata.main_language),
    failure: typeof error?.reason === "string" ? error.reason.replace(/\s+/g, " ").trim().slice(0, 160) : null,
  };
}

/** Ids of the conversations of these agents that started at or after `since`, newest first. */
export async function listConversationIds({
  agentIds,
  since,
  limit = 100,
  env = process.env,
}: {
  agentIds: string[];
  since: Date;
  limit?: number;
  env?: Record<string, string | undefined>;
}): Promise<string[]> {
  const ids: string[] = [];
  for (const agentId of agentIds) {
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ agent_id: agentId, call_start_after_unix: String(Math.floor(since.getTime() / 1000)), page_size: "100", ...(cursor ? { cursor } : {}) });
      const page = await get(`/v1/convai/conversations?${query}`, env);
      for (const conversation of (page.conversations ?? []) as Array<{ conversation_id?: string }>) {
        if (conversation.conversation_id) ids.push(conversation.conversation_id);
      }
      cursor = page.has_more === true ? text(page.next_cursor) : null;
    } while (cursor && ids.length < limit);
  }
  return ids.slice(0, limit);
}

/** The plan as the subscription reports it: its credits and what its next invoice charges. */
export async function readPlanPrice(env: Record<string, string | undefined> = process.env): Promise<PlanPrice> {
  const subscription = await get("/v1/user/subscription", env);
  const invoice = (subscription.next_invoice ?? null) as { amount_due_cents?: unknown } | null;
  const cents = number(invoice?.amount_due_cents);
  return {
    tier: text(subscription.tier) ?? "unknown",
    credits: number(subscription.character_limit) ?? 0,
    creditsUsed: number(subscription.character_count) ?? 0,
    dollars: cents !== null ? cents / 100 : null,
  };
}

export type CostSummary = {
  calls: number;
  /** Calls the platform charged for. */
  charged: number;
  seconds: number;
  credits: number;
  callCredits: number;
  llmCredits: number;
  /** Null when no charged call ran. */
  creditsPerMinute: number | null;
};

/** The charged calls added up: what a minute costs in credits, on these calls. */
export function summarizeCosts(costs: ConversationCost[]): CostSummary {
  const charged = costs.filter((cost) => (cost.credits ?? 0) > 0 && cost.durationSeconds > 0);
  const seconds = charged.reduce((sum, cost) => sum + cost.durationSeconds, 0);
  const credits = charged.reduce((sum, cost) => sum + (cost.credits ?? 0) + (cost.voiceSurchargeCredits ?? 0), 0);
  return {
    calls: costs.length,
    charged: charged.length,
    seconds,
    credits,
    callCredits: charged.reduce((sum, cost) => sum + (cost.callCredits ?? 0), 0),
    llmCredits: charged.reduce((sum, cost) => sum + (cost.llmCredits ?? 0), 0),
    creditsPerMinute: seconds > 0 ? (credits / seconds) * 60 : null,
  };
}

/** One line spoken by one voice, as MP3 bytes: the samples the owner chooses the Spanish voice from. Needs text_to_speech on the key. */
export async function synthesizeSample({
  voiceId,
  text: line,
  modelId,
  languageCode,
  env = process.env,
}: {
  voiceId: string;
  text: string;
  modelId: string;
  languageCode: string;
  env?: Record<string, string | undefined>;
}): Promise<Buffer> {
  const response = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": requireKey(env), "content-type": "application/json" },
    body: JSON.stringify({ text: line, model_id: modelId, language_code: languageCode }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: { status?: string; message?: string } } | null;
    throw new Error(`ElevenLabs answered HTTP ${response.status}${body?.detail?.status ? ` (${body.detail.status})` : ""}${body?.detail?.message ? `: ${body.detail.message}` : ""}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
