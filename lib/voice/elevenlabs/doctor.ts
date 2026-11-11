import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";
import { decideVoiceCapacity, describeVoiceBalance, readBalanceFloor, type VoiceBalance } from "@/lib/voice/balance";
import { buildInterviewAgentDefinition, INTERVIEW_AGENT_DAILY_CALL_LIMIT_ENV, INTERVIEW_AGENT_ID_ENV } from "./agentConfig";
import { INTERVIEW_TIERS, type InterviewTierId } from "@/lib/plans";

/**
 * `npm run voice:doctor`: every check of the ElevenLabs workspace that the
 * voice interview depends on, read-only, each with the exact fix. The key
 * and its permissions (by the smallest harmless call each allows; the
 * permission a refusal names is printed), the balance against the floor,
 * both agents against `agentConfig.ts`, and the post-call webhook: where
 * each agent points, whether it is enabled, and whether it is the URL
 * asked for.
 *
 * On the webhook model, from the API itself: post-call webhooks are
 * **workspace objects** (`GET /v1/workspace/webhooks` lists them, several
 * per workspace) that each agent **selects by id** in
 * `platform_settings.workspace_overrides.webhooks.post_call_webhook_id`.
 * So two environments can share one workspace if each has its own pair of
 * agents and its own webhook object; what they cannot share is one agent
 * or one webhook. The sync script finds the webhook by URL for that reason.
 *
 * No `server-only`: the script runs it under plain tsx. Nothing here
 * writes to the platform.
 */

export type VoiceDoctorCheck = {
  name: string;
  outcome: "pass" | "fail" | "skip";
  /** What was found, in one line. Never a secret. */
  detail: string;
  /** What to do, when it failed or could not be checked. */
  fix?: string;
};

const KEYS_PAGE = "ElevenLabs > Developer > API keys (edit the key, enable the permission, save)";

const pass = (name: string, detail: string): VoiceDoctorCheck => ({ name, outcome: "pass", detail });
const fail = (name: string, detail: string, fix: string): VoiceDoctorCheck => ({ name, outcome: "fail", detail, fix });
const skip = (name: string, detail: string, fix?: string): VoiceDoctorCheck => ({ name, outcome: "skip", detail, ...(fix ? { fix } : {}) });

/** The permission a `missing_permissions` refusal names; null for any other error. Mirrors the client's reading. */
function namedPermission(error: unknown): string | null {
  if (!(error instanceof ElevenLabsError)) return null;
  if (error.statusCode !== 401 && error.statusCode !== 403) return null;
  const detail = (error.body as { detail?: { status?: unknown; message?: unknown } } | undefined)?.detail;
  if (detail?.status !== "missing_permissions") return null;
  const message = typeof detail.message === "string" ? detail.message : "";
  return /permission\s+(\S+)\s+to/.exec(message)?.[1] ?? "(unnamed)";
}

/** A failed check from a platform error: a missing permission is named with its fix; anything else as the platform said it. */
/** The limits that decide whether a call is taken: the daily cap and where it comes from, bursting, the queue. */
function describeLimits(tier: InterviewTierId, settings: { callLimits?: { dailyLimit?: number; burstingEnabled?: boolean }; queueingConfig?: { enabled?: boolean; waitTimeoutSeconds?: number } } | undefined, env: Record<string, string | undefined>): string {
  const fromEnv = Boolean(env[INTERVIEW_AGENT_DAILY_CALL_LIMIT_ENV[tier]]?.trim());
  const daily = `daily cap ${settings?.callLimits?.dailyLimit ?? "?"} (${fromEnv ? INTERVIEW_AGENT_DAILY_CALL_LIMIT_ENV[tier] : "the default"})`;
  const burst = `bursting ${settings?.callLimits?.burstingEnabled ? "on" : "OFF"}`;
  const queue = settings?.queueingConfig?.enabled ? `queue on (wait ${settings.queueingConfig.waitTimeoutSeconds ?? "?"} s)` : "queue OFF";
  return `${daily}, ${burst}, ${queue}`;
}

/** The platform refused the key itself, not one permission of it. */
function keyRejected(error: unknown): boolean {
  return error instanceof ElevenLabsError && (error.statusCode === 401 || error.statusCode === 403) && !namedPermission(error);
}

function failFrom(name: string, error: unknown, fallbackPermission: string): VoiceDoctorCheck {
  const permission = namedPermission(error);
  if (permission) return fail(name, `the API key lacks ${permission} (the platform refused with missing_permissions)`, `Grant ${permission} at ${KEYS_PAGE}.`);
  if (error instanceof ElevenLabsError && (error.statusCode === 401 || error.statusCode === 403)) {
    return fail(name, `key rejected: expired, revoked, or from another workspace (HTTP ${error.statusCode}); needed for ${fallbackPermission}`, `Create a new key at ElevenLabs > Developer > API keys in the workspace that owns the agents, put it in ELEVENLABS_API_KEY and run this again. Until then every voice interview fails.`);
  }
  const said = error instanceof ElevenLabsError ? `HTTP ${error.statusCode ?? "?"}` : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return fail(name, `the call failed: ${said}`, "Check the key and the network, then run the doctor again.");
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const snakeCase = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/**
 * The paths at which `actual` does not carry what `expected` says. Only
 * the expected side is walked: the platform's read-back adds fields the
 * definition never set (tool descriptions, ids, timestamps), and those are
 * not drift. Arrays and scalars compare whole. A key the read-back carries
 * only in the API's own casing counts as found: the SDK passes a few
 * objects through untranslated (`dynamic_variables` is one), so the same
 * value arrives as `dynamicVariablePlaceholders` in the definition and
 * `dynamic_variable_placeholders` on read.
 */
export function definitionDifferences(expected: unknown, actual: unknown, prefix = ""): string[] {
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return [prefix || "(root)"];
    return Object.keys(expected).flatMap((key) =>
      definitionDifferences(expected[key], key in actual ? actual[key] : actual[snakeCase(key)], prefix ? `${prefix}.${key}` : key),
    );
  }
  return JSON.stringify(expected) === JSON.stringify(actual) ? [] : [prefix || "(root)"];
}

export type VoiceDoctorOptions = {
  webhookUrl: string | null;
  env?: Record<string, string | undefined>;
};

const TIERS: InterviewTierId[] = ["FULL", "TRIAL"];

export async function runVoiceDoctor({ webhookUrl, env = process.env }: VoiceDoctorOptions): Promise<VoiceDoctorCheck[]> {
  const checks: VoiceDoctorCheck[] = [];

  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    checks.push(fail("environment", "ELEVENLABS_API_KEY is not set", "Create a key at ElevenLabs > Developer > API keys and put it in ELEVENLABS_API_KEY."));
    return checks;
  }
  checks.push(pass("environment", "ELEVENLABS_API_KEY is set"));

  const agentIds = {} as Record<InterviewTierId, string | null>;
  for (const tier of TIERS) {
    const envName = INTERVIEW_AGENT_ID_ENV[tier];
    agentIds[tier] = env[envName]?.trim() || null;
    checks.push(
      agentIds[tier]
        ? pass(`agent id ${tier}`, `${envName} is set`)
        : fail(`agent id ${tier}`, `${envName} is not set`, "Run npm run agent:sync -- --webhook-url https://<host>/api/webhooks/elevenlabs and paste the id it prints."),
    );
  }

  const client = new ElevenLabsClient({ apiKey, maxRetries: 0, timeoutInSeconds: 20 });

  // The balance, which is also the proof of user_read.
  try {
    const subscription = await client.user.subscription.get();
    const limit = Math.max(0, subscription.characterLimit);
    const used = Math.max(0, subscription.characterCount);
    const balance: VoiceBalance = {
      tier: subscription.tier,
      status: subscription.status,
      creditsUsed: used,
      creditsLimit: limit,
      creditsRemaining: Math.max(0, limit - used),
      extension: subscription.maxCreditLimitExtension ?? 0,
      resetsAt: subscription.nextCharacterCountResetUnix ? new Date(subscription.nextCharacterCountResetUnix * 1000) : null,
    };
    checks.push(pass("permission user_read", describeVoiceBalance(balance)));
    checks.push(
      skip(
        "key expiry",
        "the platform does not let a key read its own expiry or credit quota (that list needs workspace_read, a workspace permission)",
        "Look at the key at ElevenLabs > Developer > API keys and note its expiry; a key with no expiry and no credit quota is the safe choice for the server.",
      ),
    );
    // One floor per agent: the full interview's, and the 5-minute trial's.
    for (const tier of ["FULL", "TRIAL"] as const) {
      const name = tier === "FULL" ? "balance floor" : "balance floor (trial)";
      const floor = readBalanceFloor(INTERVIEW_TIERS[tier].seconds, env);
      const capacity = decideVoiceCapacity(balance, floor);
      checks.push(
        floor === 0
          ? skip(name, "the check is off (ELEVENLABS_BALANCE_FLOOR_CREDITS=0): every start is attempted", "Unset ELEVENLABS_BALANCE_FLOOR_CREDITS to guard starts with the default floor.")
          : capacity.ok
            ? pass(name, `${capacity.available === Number.POSITIVE_INFINITY ? "unlimited" : capacity.available} credits reachable, floor ${floor}: starts are allowed`)
            : fail(
                name,
                `${capacity.available} credits reachable, floor ${floor}: the session endpoint refuses every ${tier === "FULL" ? "full interview" : "trial"} start as VOICE_UNAVAILABLE`,
                "Add credits or raise the plan at ElevenLabs > Subscription. The floor is the agent's hard duration at the measured rate with a margin (lib/voice/balance.ts); ELEVENLABS_BALANCE_FLOOR_CREDITS overrides it for both.",
              ),
      );
    }
  } catch (error) {
    // A refused key fails every check the same way: say it once and stop.
    if (keyRejected(error)) {
      checks.push(failFrom("key", error, "every call"));
      return checks;
    }
    checks.push(failFrom("permission user_read", error, "user_read"));
    for (const name of ["balance floor", "balance floor (trial)"]) {
      checks.push(skip(name, "not checked: the balance could not be read (see permission user_read)", "Without user_read the session endpoint logs a warning once and guards nothing."));
    }
  }

  // The agents, against the definition that `agent:sync` pushes.
  const webhookIdsSeen = new Set<string | null>();
  for (const tier of TIERS) {
    const name = `agent ${tier}`;
    const id = agentIds[tier];
    if (!id) {
      checks.push(skip(name, `not checked: ${INTERVIEW_AGENT_ID_ENV[tier]} is not set`));
      continue;
    }
    try {
      const agent = await client.conversationalAi.agents.get(id);
      const postCallWebhookId = agent.platformSettings?.workspaceOverrides?.webhooks?.postCallWebhookId ?? null;
      webhookIdsSeen.add(postCallWebhookId);
      const expected = buildInterviewAgentDefinition({ postCallWebhookId, tier, env });
      // The dashboard's test-call placeholders are left out: the platform
      // answers `dynamic_variable_placeholders: {}` on read whatever the
      // sync pushed (seen 2026-10-23), and no real session depends on them.
      const { dynamicVariables: _placeholders, ...agentWithoutPlaceholders } = expected.conversationConfig.agent ?? {};
      void _placeholders;
      const comparable = { ...expected, conversationConfig: { ...expected.conversationConfig, agent: agentWithoutPlaceholders } };
      const differences = definitionDifferences(comparable, { name: agent.name, tags: agent.tags, conversationConfig: agent.conversationConfig, platformSettings: agent.platformSettings });
      if (!postCallWebhookId) differences.push("platformSettings.workspaceOverrides.webhooks.postCallWebhookId (none attached)");
      checks.push(
        differences.length
          ? fail(name, `${id} ("${agent.name}") differs from agentConfig.ts at ${differences.join(", ")}`, "Run npm run agent:sync to push the definition in code; a change made in the dashboard is overwritten.")
          : pass(name, `${id} ("${agent.name}") matches agentConfig.ts, hard limit ${agent.conversationConfig.conversation?.maxDurationSeconds ?? "?"} s, ${describeLimits(tier, agent.platformSettings, env)}`),
      );
    } catch (error) {
      checks.push(error instanceof ElevenLabsError && error.statusCode === 404 ? fail(name, `${id} does not exist on this workspace`, `Clear ${INTERVIEW_AGENT_ID_ENV[tier]} and run npm run agent:sync to create it, or point the variable at the right agent.`) : failFrom(name, error, "agents read (ConvAI)"));
    }
  }

  checks.push(
    skip(
      "plan concurrency",
      "the subscription API does not report the plan's concurrent-call limit. With bursting on, calls past it run (up to three times the limit, at twice the rate); past that the queue holds a caller, and a wait that runs out is refused with nothing charged",
      "The plan's limit is on ElevenLabs > Subscription. Raise the plan, not the daily cap, when the room often shows the wait in line.",
    ),
  );

  // The conversation read the reconcile needs when a webhook never comes.
  try {
    const page = await client.conversationalAi.conversations.list({ pageSize: 1 });
    checks.push(pass("permission conversations read", `${page.conversations.length ? "conversations listed" : "no conversations yet"}; the reconcile can fetch a call whose webhook was lost`));
  } catch (error) {
    checks.push(failFrom("permission conversations read", error, "conversations read (ConvAI)"));
  }

  // The post-call webhook: a workspace object each agent points at by id.
  try {
    const { webhooks } = await client.webhooks.list({ includeUsages: true });
    const pointed = [...webhookIdsSeen].filter((id): id is string => id !== null);
    const found = pointed.length ? webhooks.find((webhook) => webhook.webhookId === pointed[0]) ?? null : webhookUrl ? webhooks.find((webhook) => webhook.webhookUrl === webhookUrl) ?? null : null;
    const syncFix = `Run npm run agent:sync -- --webhook-url ${webhookUrl ?? "https://<host>/api/webhooks/elevenlabs"}${webhookUrl ? " --replace-webhook" : ""} and paste the secret it prints into ELEVENLABS_WEBHOOK_SECRET.`;
    if (!found) {
      checks.push(fail("webhook", pointed.length ? `the agents point at webhook ${pointed[0]}, which the workspace does not list` : `no agent points at a webhook${webhookUrl ? ` and none is registered for ${webhookUrl}` : ""}: no transcript would ever come back`, syncFix));
    } else {
      const problems: string[] = [];
      if (webhookIdsSeen.size > 1) problems.push(`the two agents point at different webhooks (${[...webhookIdsSeen].map((id) => id ?? "none").join(", ")})`);
      if (webhookUrl && found.webhookUrl !== webhookUrl) problems.push(`points at ${found.webhookUrl}, wanted ${webhookUrl}`);
      if (found.isDisabled) problems.push("it is disabled");
      if (found.isAutoDisabled) problems.push("the platform auto-disabled it after repeated failures");
      const lastFailure = found.mostRecentFailureErrorCode ? `; last delivery failure HTTP ${found.mostRecentFailureErrorCode}${found.mostRecentFailureTimestamp ? ` at ${new Date(found.mostRecentFailureTimestamp * 1000).toISOString()}` : ""}` : "";
      const where = `${found.webhookId} "${found.name}" -> ${found.webhookUrl} (${found.authType}, used by ${found.usage?.length ?? 0} agent setting(s))${lastFailure}`;
      checks.push(
        problems.length
          ? fail("webhook", `${where}: ${problems.join("; ")}`, found.isDisabled || found.isAutoDisabled ? "Re-enable it at ElevenLabs > Developer > Webhooks, then check the route answers 200." : syncFix)
          : pass("webhook", where),
      );
    }
  } catch (error) {
    checks.push(failFrom("webhook", error, "webhooks read"));
  }

  const secret = env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  checks.push(
    secret
      ? skip("webhook secret", `ELEVENLABS_WEBHOOK_SECRET is set (${secret.length} characters); the platform never returns a webhook's secret, so it cannot be compared here`, "If deliveries are answered 401 in the logs, recreate the webhook (npm run agent:sync -- --webhook-url … --replace-webhook) and paste the new secret.")
      : fail("webhook secret", "ELEVENLABS_WEBHOOK_SECRET is not set: every delivery is answered 500", "Paste the secret agent:sync printed, or recreate the webhook with --replace-webhook to get a new one."),
  );

  checks.push(skip("permission token issue (ConvAI write)", "cannot be proven without minting a conversation; needed by every start (the session endpoint)", `Make sure the key has the ConvAI write permission at ${KEYS_PAGE}: without it every Start answers VOICE_MISCONFIGURED.`));
  checks.push(skip("permission webhooks write", "cannot be proven without creating or deleting a webhook; needed by npm run agent:sync", `Make sure the key has the webhooks write permission at ${KEYS_PAGE} before running agent:sync with --webhook-url.`));

  return checks;
}
