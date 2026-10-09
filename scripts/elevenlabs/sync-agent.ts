/**
 * Pushes the interview agent defined in lib/elevenlabs/agentConfig.ts to
 * ElevenLabs, so the dashboard mirrors the code and not the other way round.
 *
 *   npm run agent:sync -- [--webhook-url https://host/api/webhooks/elevenlabs] [--dry-run]
 *
 * Idempotent: with ELEVENLABS_AGENT_ID unset it creates the agent and prints
 * the id to put in .env; with it set it updates that agent in place. The
 * post-call webhook is a workspace object found by name; when it does not
 * exist and --webhook-url is given, it is created and its secret is printed
 * once (it cannot be read back), to put in ELEVENLABS_WEBHOOK_SECRET.
 * Without a webhook the agent is pushed anyway, with a warning: sessions
 * would run but no transcript would come back.
 *
 * Reads ELEVENLABS_API_KEY from .env. Never prints it.
 */
import { parseArgs } from "node:util";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  buildInterviewAgentDefinition,
  INTERVIEW_WEBHOOK_NAME,
} from "@/lib/elevenlabs/agentConfig";

const { values: args } = parseArgs({
  options: {
    "webhook-url": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim() || null;

  if (args["dry-run"]) {
    const definition = buildInterviewAgentDefinition({ postCallWebhookId: "<webhook id>" });
    console.log(JSON.stringify(definition, null, 2));
    console.log(`\n(dry run) would ${agentId ? `update agent ${agentId}` : "create a new agent"}`);
    return;
  }

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set (see .env.template)");
  }

  const client = new ElevenLabsClient({ apiKey, maxRetries: 0, timeoutInSeconds: 30 });

  const postCallWebhookId = await ensureWebhook(client, args["webhook-url"] ?? null);
  const definition = buildInterviewAgentDefinition({ postCallWebhookId });

  let resultingAgentId: string;
  if (agentId) {
    await client.conversationalAi.agents.update(agentId, definition);
    resultingAgentId = agentId;
    console.log(`Updated agent ${agentId}`);
  } else {
    const created = await client.conversationalAi.agents.create(definition);
    resultingAgentId = created.agentId;
    console.log(`Created agent ${created.agentId}`);
    console.log(`\nPut this in .env:\nELEVENLABS_AGENT_ID=${created.agentId}\n`);
  }

  await printEffectiveSettings(client, resultingAgentId);
}

/** The workspace webhook id to attach, creating it when asked to. */
async function ensureWebhook(
  client: ElevenLabsClient,
  webhookUrl: string | null,
): Promise<string | null> {
  const { webhooks } = await client.webhooks.list({ includeUsages: true });
  const existing = webhooks.find((webhook) => webhook.name === INTERVIEW_WEBHOOK_NAME);

  if (existing) {
    const state = existing.isDisabled
      ? "DISABLED"
      : existing.isAutoDisabled
        ? "AUTO-DISABLED after repeated failures"
        : "enabled";
    console.log(`Webhook "${existing.name}" ${existing.webhookId} -> ${existing.webhookUrl} (${state})`);
    if (webhookUrl && webhookUrl !== existing.webhookUrl) {
      console.warn(
        `  --webhook-url differs from the existing URL; update it in the dashboard (Settings > Webhooks) or delete and re-run.`,
      );
    }
    if (existing.isDisabled || existing.isAutoDisabled) {
      console.warn("  Re-enable it in the dashboard; transcripts are not being delivered.");
    }
    return existing.webhookId;
  }

  if (!webhookUrl) {
    console.warn(
      `No webhook named "${INTERVIEW_WEBHOOK_NAME}" exists and --webhook-url was not given: pushing the agent without a post-call webhook.`,
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

/** What the platform now holds for the limits and access settings that matter. */
async function printEffectiveSettings(client: ElevenLabsClient, agentId: string) {
  const agent = await client.conversationalAi.agents.get(agentId);
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

  console.log("\nEffective settings on ElevenLabs:");
  for (const [label, value] of lines) {
    console.log(`  ${label.padEnd(24)} ${JSON.stringify(value)}`);
  }
}

main().catch((error: unknown) => {
  // The SDK error body can echo the request; the message and status are enough.
  const status = (error as { statusCode?: unknown })?.statusCode;
  console.error(
    `sync-agent failed${typeof status === "number" ? ` (HTTP ${status})` : ""}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
