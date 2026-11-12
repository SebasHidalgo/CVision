/**
 * Pushes the two interview agents defined in lib/voice/elevenlabs/agentConfig.ts
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
import { syncAgents } from "@/lib/voice/admin";

const { values: args } = parseArgs({
  options: {
    "webhook-url": { type: "string" },
    "replace-webhook": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

async function main() {
  const unexpected = await syncAgents({
    webhookUrl: args["webhook-url"] ?? null,
    replaceWebhook: args["replace-webhook"],
    dryRun: args["dry-run"],
  });
  if (unexpected > 0) process.exitCode = 1;
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
    // Not process.exit: a forced exit with a request still open trips a Node assertion on Windows.
    process.exitCode = 1;
  });
}
