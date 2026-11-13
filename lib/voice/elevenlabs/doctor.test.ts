import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildInterviewAgentDefinition, END_INTERVIEW_TOOL_CONFIG, INTERVIEW_WEBHOOK_NAME } from "./agentConfig";
import { definitionDifferences, RECENT_CALLS_READ, runVoiceDoctor } from "./doctor";

/**
 * The doctor against a stubbed ElevenLabs: every request is answered from
 * a table keyed by method and path, so each check can be driven to pass or
 * fail. The agents' read-back is the definition itself in the API's casing
 * plus the fields the platform adds, which the comparison must ignore.
 */

const API_KEY = "test-elevenlabs-key";
const FULL_ID = "agent_full_0001";
const TRIAL_ID = "agent_trial_0001";
const WEBHOOK_ID = "6da9664598144153b0f6303fb2d92aa7";
const WEBHOOK_URL = "https://tunnel.example/api/webhooks/elevenlabs";
const TOOL_ID = "tool_end_0001";

type Answer = { status?: number; body: unknown };
type Table = Record<string, Answer | ((url: URL) => Answer)>;

const missing = (permission: string): Answer => ({
  status: 401,
  body: { detail: { type: "authentication_error", code: "unauthorized", message: `The API key you used is missing the permission ${permission} to execute this operation.`, status: "missing_permissions" } },
});

/** camelCase keys to the API's snake_case, recursively; keys that are already snake (placeholders, language codes) are untouched. */
function snake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snake);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), snake(entry)]));
}

function agentReadback(tier: "FULL" | "TRIAL", overrides: Record<string, unknown> = {}) {
  const definition = buildInterviewAgentDefinition({ postCallWebhookId: WEBHOOK_ID, endToolId: TOOL_ID, tier });
  const body = snake({ agentId: tier === "FULL" ? FULL_ID : TRIAL_ID, ...definition }) as Record<string, unknown>;
  // What the platform adds on read: ids, timestamps, tool defaults. And
  // what it drops: the placeholders come back empty whatever was pushed.
  const config = body.conversation_config as Record<string, Record<string, unknown>>;
  (config.agent.prompt as Record<string, unknown>).tools = [];
  (config.agent.prompt as Record<string, unknown>).mcp_server_ids = [];
  config.agent.dynamic_variables = { dynamic_variable_placeholders: {} };
  body.metadata = { created_at_unix_secs: 1_760_000_000, updated_at_unix_secs: 1_760_000_000 };
  body.version_id = "ver_1";
  // The workflow comes back with its (empty) graph.
  body.workflow = { ...(body.workflow as Record<string, unknown>), edges: {}, nodes: {} };
  return { ...body, ...overrides };
}

const subscription = (overrides: Record<string, unknown> = {}) => ({
  tier: "creator",
  status: "active",
  character_count: 50_000,
  character_limit: 121_000,
  max_credit_limit_extension: 0,
  can_extend_character_limit: false,
  allowed_to_extend_character_limit: false,
  next_character_count_reset_unix: 1_764_547_200,
  voice_slots_used: 0,
  professional_voice_slots_used: 0,
  professional_voice_slots_used_in_workspace: 0,
  voice_limit: 10,
  voice_add_edit_counter: 0,
  professional_voice_limit: 1,
  can_extend_voice_limit: false,
  can_use_instant_voice_cloning: true,
  can_use_professional_voice_cloning: true,
  current_overage: { amount: "0", currency: "usd" },
  open_invoices: [],
  has_open_invoices: false,
  ...overrides,
});

const webhook = (overrides: Record<string, unknown> = {}) => ({
  name: INTERVIEW_WEBHOOK_NAME,
  webhook_id: WEBHOOK_ID,
  webhook_url: WEBHOOK_URL,
  is_disabled: false,
  is_auto_disabled: false,
  created_at_unix: 1_760_000_000,
  auth_type: "hmac",
  usage: [{ usage_type: "ConvAI Agent Settings" }, { usage_type: "ConvAI Agent Settings" }],
  ...overrides,
});

/** The workspace's tools as the platform lists them: the room's tool, and whatever else lives there. */
const workspaceTools = (tools: { id: string; name: string; type?: string }[] = [{ id: TOOL_ID, name: END_INTERVIEW_TOOL_CONFIG.name }]) => ({
  tools: tools.map((tool) => ({
    id: tool.id,
    tool_config: { type: tool.type ?? "client", name: tool.name, description: "x", expects_response: true },
    access_info: { is_creator: true, creator_name: "Owner", creator_email: "owner@example.test", role: "admin" },
    usage_stats: { avg_latency_secs: 0 },
  })),
  has_more: false,
});

/** One row of the conversations list, and the record behind it, in the API's casing. */
const listed = (id: string, agentId: string) => ({ agent_id: agentId, conversation_id: id, start_time_unix_secs: 1_760_000_000, call_duration_secs: 300, message_count: 4, status: "done", call_successful: "success" });
const conversation = (id: string, agentId: string, transcript: Record<string, unknown>[]) => ({
  agent_id: agentId,
  conversation_id: id,
  status: "done",
  transcript,
  metadata: { start_time_unix_secs: 1_760_000_000, call_duration_secs: 300, termination_reason: "Client disconnected: 1005" },
  has_audio: false,
  has_user_audio: false,
  has_response_audio: false,
  has_auxiliary_audio: false,
});

const SARAH = "EXAVITQu4vr4xnSDxMaL";
const NORAH = "kcQkGnn0HAT2JRDQ4Ljp";

/** A library voice as the platform returns it: someone else's, copied into the workspace. */
const libraryVoice = (sharing: Record<string, unknown> = {}, state: Record<string, string> = { eleven_flash_v2_5: "fine_tuned" }) => ({
  voice_id: NORAH,
  name: "Norah",
  category: "professional",
  fine_tuning: { state },
  sharing: { status: "copied", original_voice_id: NORAH, public_owner_id: "owner_1", rate: 1, fiat_rate: null, notice_period: 730, disable_at_unix: null, ...sharing },
});

function healthy(): Table {
  return {
    [`GET /v1/voices/${SARAH}`]: { body: { voice_id: SARAH, name: "Sarah", category: "premade", fine_tuning: { state: {} }, sharing: null } },
    [`GET /v1/voices/${NORAH}`]: { body: libraryVoice() },
    "GET /v1/user/subscription": { body: subscription() },
    "GET /v1/convai/tools": { body: workspaceTools() },
    [`GET /v1/convai/agents/${FULL_ID}`]: { body: agentReadback("FULL") },
    [`GET /v1/convai/agents/${TRIAL_ID}`]: { body: agentReadback("TRIAL") },
    "GET /v1/convai/conversations": { body: { conversations: [], has_more: false, next_cursor: null } },
    "GET /v1/workspace/webhooks": { body: { webhooks: [webhook()] } },
  };
}

const requests: { method: string; url: URL; headers: Headers }[] = [];

function serve(table: Table) {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      requests.push({ method, url, headers: new Headers(init?.headers) });
      const entry = table[`${method} ${url.pathname}`];
      if (!entry) return Response.json({ detail: "no stub" }, { status: 404 });
      const answer = typeof entry === "function" ? entry(url) : entry;
      return Response.json(answer.body, { status: answer.status ?? 200 });
    }),
  );
}

const env = (overrides: Record<string, string | undefined> = {}) => ({
  ELEVENLABS_API_KEY: API_KEY,
  ELEVENLABS_AGENT_ID: FULL_ID,
  ELEVENLABS_TRIAL_AGENT_ID: TRIAL_ID,
  ELEVENLABS_WEBHOOK_SECRET: "wsec_0123456789abcdef0123456789abcdef",
  ...overrides,
});

const byName = (checks: Awaited<ReturnType<typeof runVoiceDoctor>>, name: string) => {
  const check = checks.find((entry) => entry.name === name);
  if (!check) throw new Error(`no check named ${name}: ${checks.map((entry) => entry.name).join(", ")}`);
  return check;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("voice:doctor", () => {
  it("passes a healthy workspace: balance over the floor, both agents as in code, one enabled webhook at the URL, every call with the key", async () => {
    serve(healthy());
    const checks = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() });

    expect(checks.filter((check) => check.outcome === "fail")).toEqual([]);
    expect(byName(checks, "permission user_read")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("71000 of 121000 credits left") });
    expect(byName(checks, "balance floor")).toMatchObject({ outcome: "pass", detail: "71000 credits reachable, floor 7329 (12 min + 60 s of grace x 451 credits a minute x 1.25): starts are allowed" });
    expect(byName(checks, "end tool")).toMatchObject({ outcome: "pass", detail: expect.stringContaining(`${TOOL_ID} "end_interview" is in the workspace`) });
    // The platform's limit is the paid length plus the grace.
    expect(byName(checks, "agent FULL")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("hard limit 780 s, daily cap 100") });
    expect(byName(checks, "agent TRIAL")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("hard limit 360 s, daily cap 25") });
    expect(byName(checks, "permission conversations read").outcome).toBe("pass");
    expect(byName(checks, "backup model (recent calls)")).toMatchObject({ outcome: "skip", detail: "no call of these agents among the latest conversations" });
    expect(byName(checks, "webhook")).toMatchObject({ outcome: "pass", detail: expect.stringContaining(`${WEBHOOK_ID} "${INTERVIEW_WEBHOOK_NAME}" -> ${WEBHOOK_URL} (hmac; 2 of the 2 agent(s) read point at it)`) });
    expect(byName(checks, "webhook secret")).toMatchObject({ outcome: "skip", detail: expect.stringContaining("cannot be compared here") });
    expect(byName(checks, "permission token issue (ConvAI write)").outcome).toBe("skip");

    for (const request of requests) expect(request.headers.get("xi-api-key")).toBe(API_KEY);
    expect(requests.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      "GET /v1/user/subscription",
      "GET /v1/convai/tools",
      `GET /v1/convai/agents/${FULL_ID}`,
      `GET /v1/convai/agents/${TRIAL_ID}`,
      `GET /v1/voices/${SARAH}`,
      `GET /v1/voices/${NORAH}`,
      "GET /v1/convai/conversations",
      "GET /v1/workspace/webhooks",
    ]);
    // Nothing secret in any line.
    for (const check of checks) expect(`${check.detail} ${check.fix ?? ""}`).not.toContain(API_KEY);
    for (const check of checks) expect(`${check.detail} ${check.fix ?? ""}`).not.toContain("wsec_");
  });

  it("names the missing permission the platform names, which is what the owner's key lacked (user_read), and skips the floor", async () => {
    serve({ ...healthy(), "GET /v1/user/subscription": missing("user_read") });
    const checks = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() });

    expect(byName(checks, "permission user_read")).toMatchObject({ outcome: "fail", detail: "the API key lacks user_read (the platform refused with missing_permissions)", fix: expect.stringContaining("Grant user_read at ElevenLabs > Developer > API keys") });
    expect(byName(checks, "balance floor").outcome).toBe("skip");
    expect(byName(checks, "balance floor (trial)").outcome).toBe("skip");
  });

  it("says a rejected key is rejected, once, and stops", async () => {
    serve({ ...healthy(), "GET /v1/user/subscription": { status: 401, body: { detail: { status: "invalid_api_key", message: "Invalid API key" } } } });
    const checks = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() });

    expect(byName(checks, "key")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("key rejected: expired, revoked, or from another workspace") });
    expect(checks.filter((check) => check.outcome === "fail")).toHaveLength(1);
    expect(checks.at(-1)?.name).toBe("key");
  });

  it("fails the floor when the credits left are below it, and counts an unlimited extension as enough", async () => {
    serve({ ...healthy(), "GET /v1/user/subscription": { body: subscription({ character_count: 120_000 }) } });
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "balance floor")).toMatchObject({
      outcome: "fail",
      detail: "1000 credits reachable, floor 7329 (12 min + 60 s of grace x 451 credits a minute x 1.25): the session endpoint refuses every full interview start as VOICE_UNAVAILABLE",
    });

    // Enough for the 5-minute trial, not for a full interview.
    serve({ ...healthy(), "GET /v1/user/subscription": { body: subscription({ character_count: 115_000 }) } });
    const trialOnly = await runVoiceDoctor({ webhookUrl: null, env: env() });
    expect(byName(trialOnly, "balance floor").outcome).toBe("fail");
    expect(byName(trialOnly, "balance floor (trial)")).toMatchObject({ outcome: "pass", detail: "6000 credits reachable, floor 3383 (5 min + 60 s of grace x 451 credits a minute x 1.25): starts are allowed" });

    serve({ ...healthy(), "GET /v1/user/subscription": { body: subscription({ character_count: 120_000, max_credit_limit_extension: "unlimited" }) } });
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "balance floor")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("unlimited credits reachable") });

    serve(healthy());
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env({ ELEVENLABS_BALANCE_FLOOR_CREDITS: "0" }) }), "balance floor").outcome).toBe("skip");
  });

  it("reports an agent that drifted from agentConfig.ts, naming the paths, and one that no longer exists", async () => {
    const drifted = agentReadback("FULL") as Record<string, Record<string, Record<string, unknown>>>;
    drifted.platform_settings.call_limits.daily_limit = 500;
    drifted.conversation_config.conversation.max_duration_seconds = 1800;
    serve({ ...healthy(), [`GET /v1/convai/agents/${FULL_ID}`]: { body: drifted }, [`GET /v1/convai/agents/${TRIAL_ID}`]: { status: 404, body: { detail: "not found" } } });
    const checks = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() });

    expect(byName(checks, "agent FULL")).toMatchObject({
      outcome: "fail",
      detail: expect.stringContaining("differs from agentConfig.ts at conversationConfig.conversation.maxDurationSeconds, platformSettings.callLimits.dailyLimit"),
      fix: expect.stringContaining("npm run agent:sync"),
    });
    expect(byName(checks, "agent TRIAL")).toMatchObject({ outcome: "fail", detail: `${TRIAL_ID} does not exist on this workspace` });
  });

  it("fails the webhook when it points elsewhere, is disabled, or the agents disagree, and when the secret is missing", async () => {
    serve({ ...healthy(), "GET /v1/workspace/webhooks": { body: { webhooks: [webhook({ webhook_url: "https://old.example/api/webhooks/elevenlabs", is_auto_disabled: true, most_recent_failure_error_code: 502 })] } } });
    let checks = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env({ ELEVENLABS_WEBHOOK_SECRET: "" }) });
    expect(byName(checks, "webhook")).toMatchObject({
      outcome: "fail",
      detail: expect.stringMatching(/points at https:\/\/old\.example\/api\/webhooks\/elevenlabs, wanted https:\/\/tunnel\.example.*auto-disabled/),
    });
    expect(byName(checks, "webhook").detail).toContain("last delivery failure HTTP 502");
    expect(byName(checks, "webhook secret")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("not set") });

    const other = agentReadback("TRIAL") as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    other.platform_settings.workspace_overrides.webhooks.post_call_webhook_id = "other_webhook";
    serve({ ...healthy(), [`GET /v1/convai/agents/${TRIAL_ID}`]: { body: other } });
    checks = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() });
    expect(byName(checks, "webhook")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("the two agents point at different webhooks") });
    // The trial agent differs from its definition exactly at the webhook it points at.
    expect(byName(checks, "agent TRIAL").outcome).toBe("pass");
  });

  it("fails when the workspace has no end_interview tool: the interviewer could never ask for the end", async () => {
    serve({ ...healthy(), "GET /v1/convai/tools": { body: workspaceTools([{ id: "tool_other", name: "end_interview_old" }]) } });
    const checks = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() });
    expect(byName(checks, "end tool")).toMatchObject({ outcome: "fail", detail: expect.stringContaining('the workspace has no "end_interview" client tool'), fix: expect.stringContaining("npm run agent:sync") });
    // The lookup asks for client tools by name.
    const lookup = requests.find((request) => request.url.pathname === "/v1/convai/tools");
    expect(lookup?.url.searchParams.get("search")).toBe("end_interview");
    expect(lookup?.url.searchParams.get("types")).toBe("client");

    serve({ ...healthy(), "GET /v1/convai/tools": missing("convai_read") });
    expect(byName(await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() }), "end tool")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("convai_read") });
  });

  it("fails an agent that can still hang up by itself, and one the room's tool is not attached to", async () => {
    const withEndCall = agentReadback("FULL") as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    withEndCall.conversation_config.agent.prompt.built_in_tools = { end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } } };
    const detached = agentReadback("TRIAL") as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    detached.conversation_config.agent.prompt.tool_ids = [];
    serve({ ...healthy(), [`GET /v1/convai/agents/${FULL_ID}`]: { body: withEndCall }, [`GET /v1/convai/agents/${TRIAL_ID}`]: { body: detached } });
    const checks = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() });

    // The definition's empty built-in tools cannot show an end_call left on: it is looked for by name.
    expect(byName(checks, "agent FULL")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("the way a call ends (the platform's end_call tool is still on: the interviewer could hang up by itself)"), fix: expect.stringContaining("npm run agent:sync") });
    expect(byName(checks, "agent FULL").detail).not.toContain("toolIds");
    expect(byName(checks, "agent TRIAL")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("conversationConfig.agent.prompt.toolIds") });
    expect(byName(checks, "agent TRIAL").detail).toContain(`the end_interview tool (${TOOL_ID}) is not attached`);
  });

  it("counts, over the latest calls of these agents, the interviewer turns the backup model answered", async () => {
    const words = (role: string, message: string, extra: Record<string, unknown> = {}) => ({ role, message, time_in_call_secs: 1, ...extra });
    serve({
      ...healthy(),
      "GET /v1/convai/conversations": { body: { conversations: [listed("conv_a", FULL_ID), listed("conv_b", TRIAL_ID), listed("conv_other", "agent_someone_else")], has_more: false, next_cursor: null } },
      "GET /v1/convai/conversations/conv_a": {
        body: conversation("conv_a", FULL_ID, [
          words("agent", "Welcome."),
          words("user", "Hello."),
          words("agent", "What did you build last?", { llm_override: "gpt-4o" }),
          // A tool entry right after the words: the same turn, as the server counts it.
          { role: "agent", message: null, time_in_call_secs: 2, llm_override: "gpt-4o" },
          words("user", "A billing service."),
          words("agent", "And what was hard about it?", { llm_override: "gpt-4o" }),
        ]),
      },
      // The owner's 4:24 shape: the primary wrote the words, the backup only the tool call. The server counts it; so does the doctor.
      "GET /v1/convai/conversations/conv_b": { body: conversation("conv_b", TRIAL_ID, [words("agent", "Welcome."), words("user", "Hello."), words("agent", "Tell me about your last role."), { role: "agent", message: null, time_in_call_secs: 9, llm_override: "gpt-4o" }]) },
    });
    const checks = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() });

    expect(byName(checks, "backup model (recent calls)")).toMatchObject({
      outcome: "pass",
      detail: expect.stringContaining("the latest 2 call(s): 3 of 5 interviewer turn(s) were answered by the backup model (gpt-4o), in conv_a (2 of 3), conv_b (1 of 2)."),
    });
    expect(byName(checks, "backup model (recent calls)").detail).toContain("[CVision][voice] call end");
    // Another workspace agent's call is not read, and the list asks for the latest ten.
    expect(requests.some((request) => request.url.pathname.endsWith("/conv_other"))).toBe(false);
    expect(RECENT_CALLS_READ).toBe(10);
    expect(requests.find((request) => request.url.pathname === "/v1/convai/conversations")?.url.searchParams.get("page_size")).toBe("10");

    // A record that cannot be read is said, and is not a second "permission" failure.
    serve({
      ...healthy(),
      "GET /v1/convai/conversations": { body: { conversations: [listed("conv_a", FULL_ID), listed("conv_b", TRIAL_ID)], has_more: false, next_cursor: null } },
      "GET /v1/convai/conversations/conv_b": { body: conversation("conv_b", TRIAL_ID, [words("agent", "Welcome.", { llm_override: "gpt-4o" })]) },
    });
    const partial = await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() });
    expect(byName(partial, "backup model (recent calls)")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("the latest 1 call(s): 1 of 1 interviewer turn(s) were answered by the backup model (gpt-4o), in conv_b (1 of 1). 1 record(s) could not be read (conv_a).") });
    expect(partial.filter((check) => check.name === "permission conversations read")).toEqual([expect.objectContaining({ outcome: "pass" })]);
    serve({ ...healthy(), "GET /v1/convai/conversations": { body: { conversations: [listed("conv_a", FULL_ID)], has_more: false, next_cursor: null } } });
    expect(byName(await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() }), "backup model (recent calls)")).toMatchObject({ outcome: "skip", detail: "none of the latest 1 call(s) could be read (conv_a)" });

    // No backup turn at all: said plainly, with nothing listed.
    serve({ ...healthy(), "GET /v1/convai/conversations": { body: { conversations: [listed("conv_b", TRIAL_ID)], has_more: false, next_cursor: null } }, "GET /v1/convai/conversations/conv_b": { body: conversation("conv_b", TRIAL_ID, [words("agent", "Welcome."), words("user", "Hello.")]) } });
    expect(byName(await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() }), "backup model (recent calls)").detail).toContain("the latest 1 call(s): 0 of 1 interviewer turn(s) were answered by the backup model.");
  });

  it("stops at the environment when the key is missing, and names unset agent ids without calling out", async () => {
    serve(healthy());
    const noKey = await runVoiceDoctor({ webhookUrl: null, env: env({ ELEVENLABS_API_KEY: "" }) });
    expect(noKey).toEqual([expect.objectContaining({ name: "environment", outcome: "fail" })]);
    expect(requests).toHaveLength(0);

    const noTrial = await runVoiceDoctor({ webhookUrl: null, env: env({ ELEVENLABS_TRIAL_AGENT_ID: "" }) });
    expect(byName(noTrial, "agent id TRIAL").outcome).toBe("fail");
    expect(byName(noTrial, "agent TRIAL").outcome).toBe("skip");
    expect(byName(noTrial, "agent FULL").outcome).toBe("pass");
  });
});

describe("definitionDifferences", () => {
  it("walks the expected side only: extra read-back fields are not drift, changed or missing ones are", () => {
    expect(definitionDifferences({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2], extra: true }, more: 1 })).toEqual([]);
    expect(definitionDifferences({ a: 1, b: { c: [1, 2] } }, { a: 2, b: { c: [1] } })).toEqual(["a", "b.c"]);
    expect(definitionDifferences({ a: { b: 1 } }, { a: null })).toEqual(["a"]);
    expect(definitionDifferences({ a: 1 }, {})).toEqual(["a"]);
  });

  it("accepts a key the read-back carries in the API's casing, as the SDK leaves dynamic_variables", () => {
    expect(definitionDifferences({ dynamicVariables: { dynamicVariablePlaceholders: { role: "x" } } }, { dynamicVariables: { dynamic_variable_placeholders: { role: "x" } } })).toEqual([]);
    expect(definitionDifferences({ dynamicVariables: { dynamicVariablePlaceholders: { role: "x" } } }, { dynamicVariables: { dynamic_variable_placeholders: { role: "y" } } })).toEqual(["dynamicVariables.dynamicVariablePlaceholders.role"]);
  });
it("says how many interviews the balance pays for, and what the burst rate would charge", async () => {
    serve(healthy());
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "interviews covered")).toMatchObject({
      outcome: "pass",
      detail:
        "at 451 credits a minute (measured, lib/voice/balance.ts) the balance pays for 12 full interview(s) of 12 min (5863 credits each, the 60 s of grace included) or 26 trial(s) of 5 min (2706 each). A call past the plan's concurrency limit is charged at the burst rate: 11726 credits for a full interview; the floor does not include it",
    });

    // Another plan's rate, from the environment: the floors and the count follow it.
    const other = await runVoiceDoctor({ webhookUrl: null, env: env({ ELEVENLABS_CREDITS_PER_MINUTE: "790" }) });
    expect(byName(other, "balance floor").detail).toBe("71000 credits reachable, floor 12838 (12 min + 60 s of grace x 790 credits a minute x 1.25): starts are allowed");
    expect(byName(other, "interviews covered").detail).toContain("at 790 credits a minute (ELEVENLABS_CREDITS_PER_MINUTE) the balance pays for 6 full interview(s)");
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env({ ELEVENLABS_BALANCE_FLOOR_CREDITS: "9000" }) }), "balance floor").detail).toBe("71000 credits reachable, floor 9000 (ELEVENLABS_BALANCE_FLOOR_CREDITS): starts are allowed");
  });

  it("checks every voice the agents speak with: the default one, and the library voice with its terms", async () => {
    serve(healthy());
    const checks = await runVoiceDoctor({ webhookUrl: null, env: env() });
    expect(byName(checks, "voice en")).toMatchObject({ outcome: "pass", detail: `${SARAH} "Sarah" (premade) on eleven_flash_v2, a default voice of the platform` });
    expect(byName(checks, "voice es")).toMatchObject({
      outcome: "pass",
      detail: `${NORAH} "Norah" (professional) on eleven_flash_v2_5, a library voice: rate x1 (no surcharge), notice period 730 days if its owner withdraws it`,
    });

    serve({ ...healthy(), [`GET /v1/voices/${NORAH}`]: { body: libraryVoice({ rate: 2, fiat_rate: 0.3 }) } });
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "voice es").detail).toContain("rate x2, USD 0.3 per 1,000 credits (a SURCHARGE: voice:cost shows it per call)");
  });

  it("fails a voice that is gone, one its owner withdraws within a month, and one not ready on its model", async () => {
    serve({ ...healthy(), [`GET /v1/voices/${NORAH}`]: { status: 400, body: { detail: { status: "voice_not_found", message: "A voice with ID 'x' was not found." } } } });
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "voice es")).toMatchObject({
      outcome: "fail",
      detail: expect.stringContaining(`${NORAH} is not a voice of this workspace`),
      fix: expect.stringContaining("INTERVIEW_AGENT_PRESET_VOICE_IDS"),
    });

    const inTenDays = Math.floor(Date.now() / 1000) + 10 * 86_400;
    serve({ ...healthy(), [`GET /v1/voices/${NORAH}`]: { body: libraryVoice({ disable_at_unix: inTenDays }) } });
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "voice es")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("is being withdrawn by its owner: it stops working on") });

    // Withdrawn, but a year away: still usable, and the date is printed.
    serve({ ...healthy(), [`GET /v1/voices/${NORAH}`]: { body: libraryVoice({ disable_at_unix: inTenDays + 365 * 86_400 }) } });
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "voice es")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("its owner is withdrawing it: usable until") });

    serve({ ...healthy(), [`GET /v1/voices/${NORAH}`]: { body: libraryVoice({}, { eleven_flash_v2_5: "queued" }) } });
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "voice es")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("is not ready on eleven_flash_v2_5 (queued)") });

    serve({ ...healthy(), [`GET /v1/voices/${SARAH}`]: missing("voices_read") });
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "voice en")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("voices_read") });
  });

  it("says how many of the agents it read point at the webhook, not how many kinds of object use it", async () => {
    serve(healthy());
    expect(byName(await runVoiceDoctor({ webhookUrl: WEBHOOK_URL, env: env() }), "webhook").detail).toContain("(hmac; 2 of the 2 agent(s) read point at it)");
  });
});
