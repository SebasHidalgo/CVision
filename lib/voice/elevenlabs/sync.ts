/**
 * The agents as code, pushed to ElevenLabs: create or update both, attach the
 * post-call webhook, read both back and list every field in which they differ.
 * scripts/voice/sync-agent.ts is the command line for it.
 */
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  buildInterviewAgentDefinition,
  diffPaths,
  END_INTERVIEW_TOOL_CONFIG,
  EXPECTED_TIER_DIFFERENCES,
  INTERVIEW_AGENT_ID_ENV,
  INTERVIEW_WEBHOOK_NAME,
} from "./agentConfig";
import type { InterviewTierId } from "@/lib/plans";

export type SyncAgentsOptions = {
  /** Where the post-call webhook should deliver; null leaves the existing one. */
  webhookUrl: string | null;
  /** Delete and recreate the webhook when its URL changed (new secret). */
  replaceWebhook: boolean;
  /** Print the definitions and what would happen; call nothing. */
  dryRun: boolean;
};

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
  // A counter the platform keeps on an agent's (unused) workflow; seen on one agent only after the 2026-11-13 sync.
  "workflow.version",
];

/** Pushes both agents, reads them back and prints what the platform holds. Resolves to the count of unintended differences. */
export async function syncAgents({ webhookUrl, replaceWebhook, dryRun }: SyncAgentsOptions): Promise<number> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const configuredIds = Object.fromEntries(
    TIERS.map((tier) => [tier, process.env[INTERVIEW_AGENT_ID_ENV[tier]]?.trim() || null]),
  ) as Record<InterviewTierId, string | null>;

  if (dryRun) {
    const full = buildInterviewAgentDefinition({ postCallWebhookId: "<webhook id>", endToolId: "<end_interview tool id>", tier: "FULL" });
    const trial = buildInterviewAgentDefinition({ postCallWebhookId: "<webhook id>", endToolId: "<end_interview tool id>", tier: "TRIAL" });
    console.log(JSON.stringify(full, null, 2));
    console.log(`\nThe workspace tool both agents use:\n${JSON.stringify(END_INTERVIEW_TOOL_CONFIG, null, 2)}`);
    console.log(`\nThe trial agent differs from the above at:`);
    for (const path of diffPaths(full, trial)) {
      console.log(`  ${path}: ${describeValue(pick(full, path))} -> ${describeValue(pick(trial, path))}`);
    }
    for (const tier of TIERS) {
      const id = configuredIds[tier];
      console.log(`(dry run) would ${id ? `update ${tier} agent ${id}` : `create the ${tier} agent`}`);
    }
    return 0;
  }

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set (see .env.template)");
  }

  const client = new ElevenLabsClient({ apiKey, maxRetries: 0, timeoutInSeconds: 30 });

  const postCallWebhookId = await ensureWebhook(client, webhookUrl, replaceWebhook);
  const endToolId = await ensureEndTool(client);

  const agentIds = {} as Record<InterviewTierId, string>;
  for (const tier of TIERS) {
    const definition = buildInterviewAgentDefinition({ postCallWebhookId, endToolId, tier });
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
  // Only the room may hang up: the read-back must show the room's tool and no end_call.
  let wrongTools = 0;
  for (const tier of TIERS) {
    const problem = endToolProblem(agents[tier], endToolId);
    if (problem) {
      wrongTools += 1;
      console.warn(`!! ${tier} agent: ${problem}`);
    }
  }
  if (wrongTools === 0) console.log(`\nBoth agents end a call only through the room: tool ${endToolId}, no end_call.`);
  return reportDifferences(agents.FULL, agents.TRIAL) + wrongTools;
}

/** What is wrong with an agent's way to end a call as read back, or null. */
export function endToolProblem(agent: { conversationConfig: { agent?: { prompt?: { toolIds?: string[] | null; builtInTools?: { endCall?: unknown } | null } | null } | null } }, endToolId: string): string | null {
  const prompt = agent.conversationConfig.agent?.prompt;
  if (prompt?.builtInTools?.endCall) return "the platform's end_call tool is still on: the interviewer could hang up by itself";
  if (!(prompt?.toolIds ?? []).includes(endToolId)) return `the ${END_INTERVIEW_TOOL_CONFIG.name} tool (${endToolId}) is not attached: the interviewer cannot ask the room to end the call`;
  return null;
}

type ToolsApi = Pick<ElevenLabsClient["conversationalAi"]["tools"], "list">;

/** The workspace id of the end_interview client tool, or null when the workspace has none. */
export async function findEndToolId(client: { conversationalAi: { tools: ToolsApi } }): Promise<string | null> {
  const { tools } = await client.conversationalAi.tools.list({ search: END_INTERVIEW_TOOL_CONFIG.name, types: "client", pageSize: 100 });
  return tools.find((tool) => tool.toolConfig.type === "client" && tool.toolConfig.name === END_INTERVIEW_TOOL_CONFIG.name)?.id ?? null;
}

/** The workspace id of the end_interview tool the agents use, or null before the first sync. */
export async function endToolIdFromWorkspace(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set (see .env.template)");
  return findEndToolId(new ElevenLabsClient({ apiKey, maxRetries: 0, timeoutInSeconds: 20 }));
}

/** The end_interview tool as code: created once in the workspace, updated on every sync. */
async function ensureEndTool(client: ElevenLabsClient): Promise<string> {
  const existing = await findEndToolId(client);
  if (existing) {
    await client.conversationalAi.tools.update(existing, { toolConfig: END_INTERVIEW_TOOL_CONFIG });
    console.log(`Updated tool "${END_INTERVIEW_TOOL_CONFIG.name}" ${existing}`);
    return existing;
  }
  const created = await client.conversationalAi.tools.create({ toolConfig: END_INTERVIEW_TOOL_CONFIG });
  console.log(`Created tool "${END_INTERVIEW_TOOL_CONFIG.name}" ${created.id}`);
  return created.id;
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
    ["tools", cc.agent?.prompt?.toolIds],
    ["built-in tools", Object.entries(cc.agent?.prompt?.builtInTools ?? {}).flatMap(([name, tool]) => (tool ? [name] : []))],
    ["webhook id", ps?.workspaceOverrides?.webhooks?.postCallWebhookId],
    ["webhook events", ps?.workspaceOverrides?.webhooks?.events],
    ["llm", cc.agent?.prompt?.llm],
    ["language", cc.agent?.language],
    ["voice", cc.tts?.voiceId],
    ["tts model", cc.tts?.modelId],
    ["asr provider", cc.asr?.provider],
    ["daily call limit", ps?.callLimits?.dailyLimit],
    ["bursting", ps?.callLimits?.burstingEnabled],
    ["queueing", ps?.queueingConfig?.enabled],
    ["queue wait (s)", ps?.queueingConfig?.waitTimeoutSeconds],
    ["preset voices", Object.fromEntries(Object.entries(cc.languagePresets ?? {}).map(([language, preset]) => [language, preset.overrides?.tts?.voiceId ?? "(default voice)"]))],
    ["record voice", ps?.privacy?.recordVoice],
    ["retention days", ps?.privacy?.retentionDays],
  ];

  console.log(`\nEffective settings on ElevenLabs, ${tier} agent:`);
  for (const [label, value] of lines) {
    console.log(`  ${label.padEnd(24)} ${JSON.stringify(value)}`);
  }
}

/** Every field in which the two agents differ on the platform, intended or not. */
function reportDifferences(full: Agent, trial: Agent): number {
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
  } else {
    console.log("  Every difference is an intended one.");
  }
  return unexpected;
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
