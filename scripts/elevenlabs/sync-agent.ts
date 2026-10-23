/**
 * Pushes the two interview agents defined in lib/elevenlabs/agentConfig.ts
 * (the full twelve-minute interviewer and the five-minute trial) to
 * ElevenLabs, so the dashboard mirrors the code and not the other way round.
 *
 *   npm run agent:sync -- [--webhook-url https://host/api/webhooks/elevenlabs] [--replace-webhook] [--dry-run]
 *
 * Idempotent, per agent: with its env var (ELEVENLABS_AGENT_ID for the full
 * agent, ELEVENLABS_TRIAL_AGENT_ID for the trial) unset it creates the agent
 * and prints the id to put in .env; with it set it updates that agent in
 * place. Both attach the same post-call webhook, a workspace object found
 * by name; when it does not exist and --webhook-url is given, it is created
 * and its secret is printed once (it cannot be read back), to put in
 * ELEVENLABS_WEBHOOK_SECRET. A webhook's URL cannot be changed once created
 * (the platform's update call has no URL field), so a new URL, as with a
 * tunnel that changed, needs --replace-webhook: the old one is deleted and a
 * new one created, with a new secret. Without a webhook the agents are
 * pushed anyway, with a warning: sessions would run but no transcript would
 * come back.
 *
 * After the push it reads both agents back and prints, for each, the
 * settings that bound cost and access, then every field in which the two
 * differ, flagging any that is not one of the intended differences.
 *
 * Reads ELEVENLABS_API_KEY from .env. Never prints it.
 */
import { parseArgs } from "node:util";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  buildInterviewAgentDefinition,
  diffPaths,
  EXPECTED_TIER_DIFFERENCES,
  INTERVIEW_AGENT_ID_ENV,
  INTERVIEW_WEBHOOK_NAME,
} from "@/lib/elevenlabs/agentConfig";
import type { InterviewTierId } from "@/lib/plans";

const { values: args } = parseArgs({
  options: {
    "webhook-url": { type: "string" },
    "replace-webhook": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const TIERS: InterviewTierId[] = ["FULL", "TRIAL"];

/**
 * Read-back paths that may differ between the two agents besides the
 * definition's own: the platform's identity and bookkeeping fields (ids,
 * timestamps, the version and branch ids it assigns per agent).
 */
const EXPECTED_READBACK_DIFFERENCES = [
  "agentId",
  "versionId",
  "branchId",
  "mainBranchId",
  "metadata",
  "accessInfo",
  "phoneNumbers",
];

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const configuredIds = Object.fromEntries(
    TIERS.map((tier) => [tier, process.env[INTERVIEW_AGENT_ID_ENV[tier]]?.trim() || null]),
  ) as Record<InterviewTierId, string | null>;

  if (args["dry-run"]) {
    const full = buildInterviewAgentDefinition({ postCallWebhookId: "<webhook id>", tier: "FULL" });
    const trial = buildInterviewAgentDefinition({ postCallWebhookId: "<webhook id>", tier: "TRIAL" });
    console.log(JSON.stringify(full, null, 2));
    console.log(`\nThe trial agent differs from the above at:`);
    for (const path of diffPaths(full, trial)) {
      console.log(`  ${path}: ${describeValue(pick(full, path))} -> ${describeValue(pick(trial, path))}`);
    }
    for (const tier of TIERS) {
      const id = configuredIds[tier];
      console.log(`(dry run) would ${id ? `update ${tier} agent ${id}` : `create the ${tier} agent`}`);
    }
    return;
  }

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set (see .env.template)");
  }

  const client = new ElevenLabsClient({ apiKey, maxRetries: 0, timeoutInSeconds: 30 });

  const postCallWebhookId = await ensureWebhook(client, args["webhook-url"] ?? null, args["replace-webhook"]);

  const agentIds = {} as Record<InterviewTierId, string>;
  for (const tier of TIERS) {
    const definition = buildInterviewAgentDefinition({ postCallWebhookId, tier });
    const existing = configuredIds[tier];
    if (existing) {
      await client.conversationalAi.agents.update(existing, definition);
      agentIds[tier] = existing;
      console.log(`Updated ${tier} agent ${existing} ("${definition.name}")`);
    } else {
      const created = await client.conversationalAi.agents.create(definition);
      agentIds[tier] = created.agentId;
      console.log(`Created ${tier} agent ${created.agentId} ("${definition.name}")`);
      console.log(`\nPut this in .env:\n${INTERVIEW_AGENT_ID_ENV[tier]}=${created.agentId}\n`);
    }
  }

  const agents = {} as Record<InterviewTierId, Awaited<ReturnType<typeof client.conversationalAi.agents.get>>>;
  for (const tier of TIERS) {
    agents[tier] = await client.conversationalAi.agents.get(agentIds[tier]);
    printEffectiveSettings(tier, agents[tier]);
  }
  reportDifferences(agents.FULL, agents.TRIAL);
}

/**
 * The workspace webhook id to attach, creating it when asked to. Webhooks
 * are workspace objects that each agent selects by id, so a workspace may
 * hold one per environment: the one for this URL is found by URL first,
 * and only then by name (the first sync, before any URL was recorded).
 */
async function ensureWebhook(
  client: ElevenLabsClient,
  webhookUrl: string | null,
  replace: boolean,
): Promise<string | null> {
  const { webhooks } = await client.webhooks.list({ includeUsages: true });
  const existing =
    (webhookUrl ? webhooks.find((webhook) => webhook.webhookUrl === webhookUrl) : undefined) ??
    webhooks.find((webhook) => webhook.name === INTERVIEW_WEBHOOK_NAME);

  if (existing) {
    const state = existing.isDisabled
      ? "DISABLED"
      : existing.isAutoDisabled
        ? "AUTO-DISABLED after repeated failures"
        : "enabled";
    console.log(`Webhook "${existing.name}" ${existing.webhookId} -> ${existing.webhookUrl} (${state})`);

    const urlChanged = webhookUrl !== null && webhookUrl !== existing.webhookUrl;
    if (urlChanged && replace) {
      await client.webhooks.delete(existing.webhookId);
      console.log(`  Deleted it: the URL changed and --replace-webhook was given. Its secret is now invalid.`);
    } else {
      if (urlChanged) {
        console.warn(
          "  --webhook-url differs from the existing URL. A webhook's URL cannot be changed; re-run with --replace-webhook to delete and recreate it (new secret).",
        );
      }
      if (existing.isDisabled || existing.isAutoDisabled) {
        console.warn("  Re-enable it in the dashboard; transcripts are not being delivered.");
      }
      return existing.webhookId;
    }
  }

  if (!webhookUrl) {
    console.warn(
      `No webhook named "${INTERVIEW_WEBHOOK_NAME}" exists and --webhook-url was not given: pushing the agents without a post-call webhook.`,
    );
    return null;
  }

  const created = await client.webhooks.create({
    settings: { authType: "hmac", name: INTERVIEW_WEBHOOK_NAME, webhookUrl },
  });
  console.log(`Created webhook ${created.webhookId} -> ${webhookUrl}`);
  if (created.webhookSecret) {
    console.log(
      `\nThe secret is shown once. Put this in .env:\nELEVENLABS_WEBHOOK_SECRET=${created.webhookSecret}\n`,
    );
  } else {
    console.warn("  The platform did not return a secret; copy it from the dashboard.");
  }
  return created.webhookId;
}

type Agent = Awaited<ReturnType<ElevenLabsClient["conversationalAi"]["agents"]["get"]>>;

/** What the platform now holds for the limits and access settings that matter. */
function printEffectiveSettings(tier: InterviewTierId, agent: Agent) {
  const { conversationConfig: cc, platformSettings: ps } = agent;
  const overrides = ps?.overrides?.conversationConfigOverride;

  const lines: [string, unknown][] = [
    ["agent", `${agent.name} (${agent.agentId})`],
    ["max duration (s)", cc.conversation?.maxDurationSeconds],
    ["turn timeout (s)", cc.turn?.turnTimeout],
    ["silence end-call (s)", cc.turn?.silenceEndCallTimeout],
    ["auth required", ps?.auth?.enableAuth],
    ["override: language", overrides?.agent?.language],
    ["override: prompt", overrides?.agent?.prompt?.prompt],
    ["override: first message", overrides?.agent?.firstMessage],
    ["override: voice", overrides?.tts?.voiceId],
    ["webhook id", ps?.workspaceOverrides?.webhooks?.postCallWebhookId],
    ["webhook events", ps?.workspaceOverrides?.webhooks?.events],
    ["llm", cc.agent?.prompt?.llm],
    ["language", cc.agent?.language],
    ["voice", cc.tts?.voiceId],
    ["tts model", cc.tts?.modelId],
    ["asr provider", cc.asr?.provider],
    ["daily call limit", ps?.callLimits?.dailyLimit],
    ["record voice", ps?.privacy?.recordVoice],
    ["retention days", ps?.privacy?.retentionDays],
  ];

  console.log(`\nEffective settings on ElevenLabs, ${tier} agent:`);
  for (const [label, value] of lines) {
    console.log(`  ${label.padEnd(24)} ${JSON.stringify(value)}`);
  }
}

/** Every field in which the two agents differ on the platform, intended or not. */
function reportDifferences(full: Agent, trial: Agent) {
  const expected = [...EXPECTED_TIER_DIFFERENCES, ...EXPECTED_READBACK_DIFFERENCES];
  const isExpected = (path: string) => expected.some((prefix) => path === prefix || path.startsWith(`${prefix}.`));

  const differences = diffPaths(full, trial);
  console.log(`\nFields that differ between the two agents as read back (${differences.length}):`);
  let unexpected = 0;
  for (const path of differences) {
    const flag = isExpected(path) ? "   " : "!! ";
    if (!isExpected(path)) unexpected += 1;
    console.log(`  ${flag}${path}: ${describeValue(pick(full, path))} -> ${describeValue(pick(trial, path))}`);
  }
  if (unexpected > 0) {
    console.warn(
      `\n${unexpected} difference(s) marked !! are not intended: the two agents should share everything but name, tags, duration, daily cap and placeholders. Check agentConfig.ts and the dashboard.`,
    );
    process.exitCode = 1;
  } else {
    console.log("  Every difference is an intended one.");
  }
}

function pick(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((current, key) => (current as Record<string, unknown> | undefined)?.[key], value);
}

/** A value for the console: short, and never the prompt in full. */
function describeValue(value: unknown): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 70 ? `${text.slice(0, 69)}…` : text;
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    // The SDK error body can echo the request; the message and status are enough.
    const status = (error as { statusCode?: unknown })?.statusCode;
    console.error(
      `sync-agent failed${typeof status === "number" ? ` (HTTP ${status})` : ""}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
