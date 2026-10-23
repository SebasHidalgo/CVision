/**
 * Checks the ElevenLabs workspace the app runs against, read-only, and
 * prints each check as PASS, FAIL or SKIP with the exact fix: the key and
 * every permission the app uses (the one a refusal names is printed), the
 * balance against the floor the session endpoint enforces, both agents
 * against lib/elevenlabs/agentConfig.ts, and the post-call webhook each
 * agent points at: enabled, and at the URL given.
 *
 *   npm run voice:doctor
 *   npm run voice:doctor -- --webhook-url https://host/api/webhooks/elevenlabs
 *
 * Run it before every voice test and before going live. Exit code 1 when
 * any check fails. Writes nothing to the platform. Never prints the key or
 * the webhook secret.
 */
import { parseArgs } from "node:util";
import { runVoiceDoctor } from "@/lib/elevenlabs/doctor";

const { values: args } = parseArgs({
  options: {
    "webhook-url": { type: "string" },
  },
});

async function main() {
  const webhookUrl = args["webhook-url"] ?? null;
  if (webhookUrl && !/^https:\/\/.+\/api\/webhooks\/elevenlabs$/.test(webhookUrl)) {
    throw new Error("--webhook-url must be https://<host>/api/webhooks/elevenlabs");
  }

  console.log(`Checking the ElevenLabs workspace${webhookUrl ? ` for webhook ${webhookUrl}` : ""}\n`);
  const checks = await runVoiceDoctor({ webhookUrl });

  for (const check of checks) {
    console.log(`${check.outcome.toUpperCase().padEnd(4)}  ${check.name}: ${check.detail}`);
    if (check.fix) console.log(`      -> ${check.fix}`);
  }

  const failed = checks.filter((check) => check.outcome === "fail").length;
  const skipped = checks.filter((check) => check.outcome === "skip").length;
  console.log(`\n${checks.length - failed - skipped} passed, ${failed} failed, ${skipped} not provable here.`);
  if (failed > 0) process.exitCode = 1;
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`voice:doctor failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exit(1);
  });
}
