/**
 * Pushes the catalog as code (lib/billing/catalog.ts) to the billing
 * provider and reads it back: the Pro product with its monthly price, the
 * interview pack with its one-time price, and the webhook destination
 * subscribed to the events the app handles.
 *
 *   npm run billing:sync -- --webhook-url https://host/api/webhooks/paddle
 *   npm run billing:sync                      (products and prices only; the
 *                                              existing destination is listed)
 *
 * Idempotent: products and prices are found by their key and created or
 * updated to match; the destination is found by its description and its
 * URL and events are updated in place. It prints the ids and the webhook
 * secret to paste into .env (PADDLE_PRICE_PRO_MONTHLY,
 * PADDLE_PRICE_INTERVIEW_PACK, PADDLE_WEBHOOK_SECRET) and writes nothing
 * secret to the repo. Refuses to run against production unless told twice:
 * PADDLE_ENV=production and --production.
 */
import { parseArgs } from "node:util";
import { syncCatalog } from "@/lib/billing";
import { readPaddleEnvironment } from "@/lib/billing/paddle/client";
import { PRICE_ID_ENV } from "@/lib/billing/paddle/prices";

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

  console.log(`Syncing the catalog to Paddle ${environment}${webhookUrl ? ` with webhook ${webhookUrl}` : ""}\n`);
  const report = await syncCatalog({ webhookUrl });

  console.log("Products:");
  for (const product of report.products) {
    console.log(`  ${product.key.padEnd(16)} ${product.productId}  ${product.action}`);
    console.log(`  ${"".padEnd(16)} name "${product.name}", tax ${product.taxCategory}`);
    console.log(`  ${"".padEnd(16)} ${product.description ?? "(no description)"}`);
  }
  console.log("\nPrices:");
  for (const price of report.prices) {
    console.log(
      `  ${price.key.padEnd(16)} ${price.priceId}  ${price.action}  ${price.amountMinor} ${price.currency} minor units, ${price.interval ?? "one-time"}, quantity ${price.quantity.minimum}-${price.quantity.maximum}`,
    );
  }

  const { webhook } = report;
  console.log("\nWebhook destination:");
  if (webhook.action === "skipped") {
    console.log("  none exists and --webhook-url was not given: events will not be delivered.");
  } else if (webhook.action === "forbidden" && !webhook.id) {
    console.log(`  NOT CREATED. ${webhook.note}`);
  } else {
    console.log(`  ${webhook.id}  ${webhook.action}  -> ${webhook.destination}  (traffic ${webhook.trafficSource}, ${webhook.active ? "active" : "INACTIVE"})`);
    console.log(`  events: ${webhook.events.join(", ")}`);
    if (webhook.note) console.log(`  note: ${webhook.note}`);
  }

  console.log("\nPut these in .env (the secret is the destination's; keep it out of the repo):");
  for (const price of report.prices) console.log(`${PRICE_ID_ENV[price.key]}=${price.priceId}`);
  if (webhook.secret) console.log(`PADDLE_WEBHOOK_SECRET=${webhook.secret}`);
  else if (webhook.action !== "skipped") console.log("PADDLE_WEBHOOK_SECRET=  (not returned on read; copy it from Paddle > Developer tools > Notifications)");
  if (webhook.action === "forbidden") process.exitCode = 2;
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`billing:sync failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exit(1);
  });
}
