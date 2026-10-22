/**
 * Checks the Paddle account the app runs against, read-only, and prints
 * each check as PASS, FAIL or SKIP with the exact fix: the environment and
 * the keys, every API key permission CVision uses (by a harmless call each,
 * or named as unprovable), the default payment link (without which Paddle
 * refuses every transaction), the webhook destination, its events and its
 * secret, and the price ids in .env against the catalog.
 *
 *   npm run billing:doctor
 *   npm run billing:doctor -- --webhook-url https://host/api/webhooks/paddle
 *
 * Run it before every billing test and before going live. Exit code 1 when
 * any check fails. Refuses production unless told twice: PADDLE_ENV=production
 * and --production.
 */
import { parseArgs } from "node:util";
import { runBillingDoctor } from "@/lib/billing";
import { readPaddleEnvironment } from "@/lib/billing/paddle/client";

const { values: args } = parseArgs({
  options: {
    "webhook-url": { type: "string" },
    production: { type: "boolean", default: false },
  },
});

async function main() {
  const environment = readPaddleEnvironment();
  if (environment === "production" && !args.production) {
    throw new Error("PADDLE_ENV is production; pass --production to confirm you mean the live account.");
  }
  const webhookUrl = args["webhook-url"] ?? null;
  if (webhookUrl && !/^https:\/\/.+\/api\/webhooks\/paddle$/.test(webhookUrl)) {
    throw new Error("--webhook-url must be https://<host>/api/webhooks/paddle");
  }

  console.log(`Checking Paddle ${environment}${webhookUrl ? ` for webhook ${webhookUrl}` : ""}\n`);
  const checks = await runBillingDoctor({ webhookUrl });

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
    console.error(`billing:doctor failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exit(1);
  });
}
