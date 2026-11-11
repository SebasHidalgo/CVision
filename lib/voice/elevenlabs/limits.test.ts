import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_CALL_CONTEXT, INTERVIEWER_AGENT_PROMPT, INTERVIEWER_VARIABLE_NAMES } from "@/lib/ai/prompts/interviewer.agent";
import { refusedForCapacity } from "@/lib/voice/postCall";
import {
  buildInterviewAgentDefinition,
  INTERVIEW_AGENT_DAILY_CALL_LIMITS,
  INTERVIEW_AGENT_PRESET_VOICE_IDS,
  INTERVIEW_QUEUE_WAIT_SECONDS,
  interviewAgentIdsFromEnv,
  readDailyCallLimit,
  SPANISH_VOICE_CANDIDATES,
  SPANISH_VOICE_SAMPLE_TEXT,
} from "./agentConfig";
import { listConversationIds, readConversationCost, readPlanPrice, summarizeCosts, type ConversationCost } from "./cost";
import { toCallRecord, type PostCallTranscription } from "./wire";

describe("the agents at a full house", () => {
  it.each(["FULL", "TRIAL"] as const)("%s: bursting on, a queue that holds a caller for a minute", (tier) => {
    const { platformSettings } = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1", tier, env: {} });
    expect(platformSettings.callLimits).toEqual({ dailyLimit: INTERVIEW_AGENT_DAILY_CALL_LIMITS[tier], burstingEnabled: true });
    expect(platformSettings.queueingConfig).toEqual({ enabled: true, waitTimeoutSeconds: INTERVIEW_QUEUE_WAIT_SECONDS });
    expect(INTERVIEW_QUEUE_WAIT_SECONDS).toBe(60);
  });

  it("reads the daily cap per environment, and keeps the development caps when it is unset or not a positive integer", () => {
    expect(readDailyCallLimit("FULL", {})).toBe(100);
    expect(readDailyCallLimit("TRIAL", {})).toBe(25);
    expect(readDailyCallLimit("FULL", { ELEVENLABS_DAILY_CALL_LIMIT: "2500" })).toBe(2500);
    expect(readDailyCallLimit("TRIAL", { ELEVENLABS_TRIAL_DAILY_CALL_LIMIT: " 400 " })).toBe(400);
    for (const bad of ["", "0", "-5", "many", "12.5"]) expect(readDailyCallLimit("FULL", { ELEVENLABS_DAILY_CALL_LIMIT: bad })).toBe(100);

    const production = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1", env: { ELEVENLABS_DAILY_CALL_LIMIT: "2500" } });
    expect(production.platformSettings.callLimits?.dailyLimit).toBe(2500);
  });

  it("keeps the session's duration and everything but the language locked against the browser", () => {
    const overrides = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1" }).platformSettings.overrides?.conversationConfigOverride;
    expect(overrides?.agent?.language).toBe(true);
    expect(overrides?.agent?.firstMessage).toBe(false);
    expect(overrides?.agent?.maxConversationDurationMessage).toBe(false);
    // No per-session length override: a browser that could shorten a call could also lengthen it.
    expect(JSON.stringify(overrides?.conversation)).not.toContain("maxDuration");
  });
});

describe("the agents in Spanish", () => {
  const preset = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1" }).conversationConfig.languagePresets?.es;

  it("carry a Spanish cutoff line, so the platform's hard stop is never heard in English", () => {
    expect(preset?.overrides.agent?.language).toBe("es");
    expect(preset?.overrides.agent?.maxConversationDurationMessage).toMatch(/^Se nos acabó el tiempo/);
    expect(preset?.overrides.tts?.modelId).toBe("eleven_flash_v2_5");
  });

  it("keep the current voice until the owner picks one from the samples", () => {
    expect(INTERVIEW_AGENT_PRESET_VOICE_IDS.es).toBeNull();
    expect(preset?.overrides.tts).not.toHaveProperty("voiceId");
    expect(SPANISH_VOICE_CANDIDATES).toHaveLength(3);
    // Three samples of this line stay under the thousand characters the owner allowed.
    expect(SPANISH_VOICE_SAMPLE_TEXT.length * SPANISH_VOICE_CANDIDATES.length).toBeLessThan(1000);
  });

  it("tell the interviewer what kind of call this is, the clock line, and to name requirements naturally", () => {
    expect(INTERVIEWER_VARIABLE_NAMES).toContain("call_context");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("{{call_context}}");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("starts with [time]");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("keep the names of technologies, products, companies and certifications exactly as written");
    const variables = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1" }).conversationConfig.agent?.dynamicVariables as { dynamicVariablePlaceholders?: Record<string, string> } | undefined;
    expect(variables?.dynamicVariablePlaceholders?.call_context).toBe(FIRST_CALL_CONTEXT);
  });
});

describe("how a call ended, as the platform records it", () => {
  const record = (termination_reason: string | null, extra: Partial<PostCallTranscription> = {}) =>
    toCallRecord({ conversation_id: "conv_1", transcript: [], status: "done", metadata: { termination_reason, start_time_unix_secs: 1, call_duration_secs: 2 }, ...extra });

  it.each([
    ["end_call tool was called.", "agent"],
    ["Client disconnected: 1005", "client"],
    ["Max conversation duration exceeded", "limit"],
    ["", "unknown"],
    [null, "unknown"],
  ] as const)("%s is %s", (reason, endedBy) => {
    expect(record(reason).endedBy).toBe(endedBy);
  });

  it("knows a refusal for capacity from any other failed call", () => {
    const failed = (code: number, reason: string) => record("", { status: "failed", metadata: { termination_reason: "", error: { code, reason } } });
    expect(refusedForCapacity(failed(4300, "This AI agent is currently at max capacity. Please try again later."))).toBe(true);
    expect(refusedForCapacity(failed(3000, "[quota_exceeded] You've run out of credits."))).toBe(false);
    expect(refusedForCapacity(record("Client disconnected: 1005"))).toBe(false);
  });
});

describe("what calls cost", () => {
  afterEach(() => vi.unstubAllGlobals());

  const serve = (table: Record<string, unknown>) => {
    const calls: URL[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url);
      expect(new Headers(init?.headers).get("xi-api-key")).toBe("test-key");
      const body = table[url.pathname];
      return body === undefined ? Response.json({ detail: { status: "missing_permissions", message: "The API key you used is missing the permission convai_read to execute this operation." } }, { status: 401 }) : Response.json(body);
    });
    return calls;
  };
  const env = { ELEVENLABS_API_KEY: "test-key", ELEVENLABS_AGENT_ID: "agent_full", ELEVENLABS_TRIAL_AGENT_ID: "agent_trial" };

  it("reads one conversation's charge, split and wait, in the app's terms", async () => {
    serve({
      "/v1/convai/conversations/conv_1": {
        conversation_id: "conv_1",
        agent_id: "agent_trial",
        status: "done",
        metadata: {
          start_time_unix_secs: 1_794_437_368,
          call_duration_secs: 16,
          cost: 124,
          cost_fiat: 0.0249,
          queue_wait_secs: 5.9,
          main_language: "es",
          charging: { tier: "starter", is_burst: false, call_charge: 103, llm_charge: 21, voice_surcharge_charge: 4 },
        },
      },
    });
    expect(await readConversationCost("conv_1", env)).toEqual({
      conversationId: "conv_1",
      agentId: "agent_trial",
      status: "done",
      startedAt: new Date(1_794_437_368_000),
      durationSeconds: 16,
      credits: 124,
      callCredits: 103,
      llmCredits: 21,
      voiceSurchargeCredits: 4,
      dollars: 0.0249,
      tier: "starter",
      burst: false,
      queueSeconds: 5.9,
      language: "es",
      failure: null,
    });
  });

  it("lists the conversations of both agents since a date, and the plan with its price", async () => {
    const calls = serve({
      "/v1/convai/conversations": { conversations: [{ conversation_id: "conv_a" }, { conversation_id: "conv_b" }], has_more: false },
      "/v1/user/subscription": { tier: "starter", character_limit: 30_000, character_count: 1245, next_invoice: { amount_due_cents: 600 } },
    });
    expect(interviewAgentIdsFromEnv(env)).toEqual(["agent_full", "agent_trial"]);
    expect(await listConversationIds({ agentIds: interviewAgentIdsFromEnv(env), since: new Date("2026-11-01T00:00:00Z"), env })).toEqual(["conv_a", "conv_b", "conv_a", "conv_b"]);
    expect(calls[0].searchParams.get("agent_id")).toBe("agent_full");
    expect(calls[0].searchParams.get("call_start_after_unix")).toBe("1793491200");
    expect(await readPlanPrice(env)).toEqual({ tier: "starter", credits: 30_000, creditsUsed: 1245, dollars: 6 });
  });

  it("names the permission the platform names when a read is refused", async () => {
    serve({});
    await expect(readConversationCost("conv_1", env)).rejects.toThrow(/HTTP 401 \(missing_permissions\).*convai_read/);
  });

  it("adds up only the calls that were charged, and says what a minute costs", () => {
    const cost = (overrides: Partial<ConversationCost>): ConversationCost => ({
      conversationId: "c", agentId: "a", status: "done", startedAt: null, durationSeconds: 60, credits: 470, callCredits: 400, llmCredits: 70,
      voiceSurchargeCredits: null, dollars: null, tier: "starter", burst: false, queueSeconds: null, language: "en", failure: null, ...overrides,
    });
    const summary = summarizeCosts([cost({}), cost({ durationSeconds: 120, credits: 950, callCredits: 800, llmCredits: 150 }), cost({ status: "failed", durationSeconds: 0, credits: null, callCredits: null, llmCredits: null })]);
    expect(summary).toMatchObject({ calls: 3, charged: 2, seconds: 180, credits: 1420, callCredits: 1200, llmCredits: 220 });
    expect(Math.round(summary.creditsPerMinute ?? 0)).toBe(473);
    expect(summarizeCosts([]).creditsPerMinute).toBeNull();
  });
});
