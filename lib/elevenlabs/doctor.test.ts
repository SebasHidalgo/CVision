import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildInterviewAgentDefinition, INTERVIEW_WEBHOOK_NAME } from "./agentConfig";
import { definitionDifferences, runVoiceDoctor } from "./doctor";

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
  const definition = buildInterviewAgentDefinition({ postCallWebhookId: WEBHOOK_ID, tier });
  const body = snake({ agentId: tier === "FULL" ? FULL_ID : TRIAL_ID, ...definition }) as Record<string, unknown>;
  // What the platform adds on read: ids, timestamps, tool defaults. And
  // what it drops: the placeholders come back empty whatever was pushed.
  const config = body.conversation_config as Record<string, Record<string, unknown>>;
  (config.agent.prompt as Record<string, unknown>).tools = [];
  (config.agent.prompt as Record<string, unknown>).mcp_server_ids = [];
  config.agent.dynamic_variables = { dynamic_variable_placeholders: {} };
  body.metadata = { created_at_unix_secs: 1_760_000_000, updated_at_unix_secs: 1_760_000_000 };
  body.version_id = "ver_1";
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

function healthy(): Table {
  return {
    "GET /v1/user/subscription": { body: subscription() },
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
    expect(byName(checks, "balance floor")).toMatchObject({ outcome: "pass", detail: "71000 credits reachable, floor 12000: starts are allowed" });
    expect(byName(checks, "agent FULL")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("hard limit 720 s, daily cap 100") });
    expect(byName(checks, "agent TRIAL")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("hard limit 300 s, daily cap 25") });
    expect(byName(checks, "permission conversations read").outcome).toBe("pass");
    expect(byName(checks, "webhook")).toMatchObject({ outcome: "pass", detail: expect.stringContaining(`${WEBHOOK_ID} "${INTERVIEW_WEBHOOK_NAME}" -> ${WEBHOOK_URL} (hmac, used by 2 agent setting(s))`) });
    expect(byName(checks, "webhook secret")).toMatchObject({ outcome: "skip", detail: expect.stringContaining("cannot be compared here") });
    expect(byName(checks, "permission token issue (ConvAI write)").outcome).toBe("skip");

    for (const request of requests) expect(request.headers.get("xi-api-key")).toBe(API_KEY);
    expect(requests.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      "GET /v1/user/subscription",
      `GET /v1/convai/agents/${FULL_ID}`,
      `GET /v1/convai/agents/${TRIAL_ID}`,
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
  });

  it("fails the floor when the credits left are below it, and counts an unlimited extension as enough", async () => {
    serve({ ...healthy(), "GET /v1/user/subscription": { body: subscription({ character_count: 120_000 }) } });
    expect(byName(await runVoiceDoctor({ webhookUrl: null, env: env() }), "balance floor")).toMatchObject({
      outcome: "fail",
      detail: "1000 credits reachable, floor 12000: the session endpoint refuses every start as VOICE_UNAVAILABLE",
    });

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
});
