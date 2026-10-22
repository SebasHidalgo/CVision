import "server-only";

import { ApiError, type NotificationSettings } from "@paddle/paddle-node-sdk";
import { CATALOG, CATALOG_CURRENCY } from "@/lib/billing/catalog";
import { CHECKOUT_ITEMS, type DoctorCheck } from "@/lib/billing/types";
import { SUBSCRIBED_EVENTS, WEBHOOK_DESCRIPTION } from "./catalog";
import {
  PADDLE_CALL_TIMEOUT_MS,
  PADDLE_FORBIDDEN,
  paddleBaseUrl,
  paddleClient,
  readPaddleConfig,
  type PaddleConfig,
} from "./client";
import { PRICE_ID_ENV } from "./prices";

/**
 * `npm run billing:doctor`: every check of the Paddle account that the
 * app's billing depends on, read-only, each with the exact fix. Run before
 * every billing test and before going live. The permissions are verified
 * by the smallest harmless call each one allows (a list of one, a read, a
 * portal session that stores nothing); the write permissions that only a
 * real write would prove are listed as such, with what needs them. The
 * one endpoint the SDK does not wrap (the checkout settings, which hold
 * the default payment link) is read directly from the environment's host.
 */

const KEYS_PAGE = "Paddle > Developer tools > Authentication";
const CHECKOUT_SETTINGS_PAGE = "Paddle > Checkout > Checkout settings";

/** The write permissions no read-only call can prove, and what needs each. */
export const UNPROVABLE_WRITES: Record<string, string> = {
  "transaction.write": "every checkout (the server creates the transaction)",
  "subscription.write": "cancelling the subscription when an account is deleted",
  "product.write": "npm run billing:sync (products)",
  "price.write": "npm run billing:sync (prices)",
  "notification_setting.write": "npm run billing:sync (the webhook destination; the sync reports forbidden itself)",
};

const pass = (name: string, detail: string): DoctorCheck => ({ name, outcome: "pass", detail });
const fail = (name: string, detail: string, fix: string): DoctorCheck => ({ name, outcome: "fail", detail, fix });
const skip = (name: string, detail: string, fix?: string): DoctorCheck => ({ name, outcome: "skip", detail, ...(fix ? { fix } : {}) });

const grantFix = (permission: string) =>
  `Give the API key ${permission} at ${KEYS_PAGE} (open the key, tick the permission, save), or create a key with every permission the README lists and put it in PADDLE_API_KEY.`;

/** A failed check from a provider error: a missing permission is named; anything else is reported as the provider said it. */
function failFrom(name: string, permission: string, error: unknown): DoctorCheck {
  if (error instanceof ApiError && error.code === PADDLE_FORBIDDEN) {
    return fail(name, `the API key lacks ${permission} (Paddle answered forbidden)`, grantFix(permission));
  }
  const said = error instanceof ApiError ? `${error.code}` : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return fail(name, `the call failed: ${said}`, "Check the key and the network, then run the doctor again.");
}

export async function runPaddleDoctor({ webhookUrl }: { webhookUrl: string | null }): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  let config: PaddleConfig;
  try {
    config = readPaddleConfig();
    checks.push(pass("environment", `PADDLE_ENV=${config.environment}; PADDLE_API_KEY is a ${config.environment} key`));
  } catch (error) {
    checks.push(
      fail(
        "environment",
        error instanceof Error ? error.message : String(error),
        "Set PADDLE_ENV to sandbox or production, and PADDLE_API_KEY to a key of that environment (pdl_sdbx_… or pdl_live_…).",
      ),
    );
    return checks;
  }

  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim() ?? "";
  const tokenPrefix = config.environment === "sandbox" ? "test_" : "live_";
  checks.push(
    token.startsWith(tokenPrefix)
      ? pass("client token", `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is a ${config.environment} token`)
      : fail(
          "client token",
          token ? `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not a ${config.environment} token (expected ${tokenPrefix}…)` : "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set",
          `Create a client-side token at ${KEYS_PAGE} in the ${config.environment} account and put it in NEXT_PUBLIC_PADDLE_CLIENT_TOKEN.`,
        ),
  );

  const paddle = paddleClient();

  // The read permissions, by the smallest list each allows. The first
  // customer, if any, serves the portal check below.
  let firstCustomerId: string | null = null;
  const reads: Array<[string, () => Promise<string>]> = [
    ["product.read", async () => `${(await paddle.products.list({ perPage: 1 }).next()).length ? "products listed" : "no products yet"}`],
    ["price.read", async () => `${(await paddle.prices.list({ perPage: 1 }).next()).length ? "prices listed" : "no prices yet"}`],
    [
      "customer.read",
      async () => {
        const [customer] = await paddle.customers.list({ perPage: 1 }).next();
        firstCustomerId = customer?.id ?? null;
        return customer ? "customers listed" : "no customers yet";
      },
    ],
    ["transaction.read", async () => `${(await paddle.transactions.list({ perPage: 1 }).next()).length ? "transactions listed" : "no transactions yet"}`],
    ["subscription.read", async () => `${(await paddle.subscriptions.list({ perPage: 1 }).next()).length ? "subscriptions listed" : "no subscriptions yet"}`],
  ];
  for (const [permission, run] of reads) {
    try {
      checks.push(pass(`permission ${permission}`, await run()));
    } catch (error) {
      checks.push(failFrom(`permission ${permission}`, permission, error));
    }
  }

  let settings: NotificationSettings[] | null = null;
  try {
    settings = await paddle.notificationSettings.list();
    checks.push(pass("permission notification_setting.read", `${settings.length} destination(s) listed`));
  } catch (error) {
    checks.push(failFrom("permission notification_setting.read", "notification_setting.read", error));
  }

  // The portal: a session stores nothing at the provider and expires on its own.
  if (firstCustomerId) {
    try {
      await paddle.customerPortalSessions.create(firstCustomerId, []);
      checks.push(pass("permission customer_portal_session.write", "a portal session was minted (nothing stored; it expires on its own)"));
    } catch (error) {
      checks.push(failFrom("permission customer_portal_session.write", "customer_portal_session.write", error));
    }
  } else {
    checks.push(
      skip(
        "permission customer_portal_session.write",
        "no customer exists yet, so no portal session can be minted; checked on the next run after a purchase",
        `Make sure the key has customer_portal_session.write at ${KEYS_PAGE}: without it "Manage subscription" fails.`,
      ),
    );
  }

  for (const [permission, neededBy] of Object.entries(UNPROVABLE_WRITES)) {
    checks.push(skip(`permission ${permission}`, `cannot be proven without a write; needed by ${neededBy}`, `Make sure the key has ${permission} at ${KEYS_PAGE}.`));
  }

  checks.push(await checkDefaultPaymentLink(config));
  checks.push(...checkWebhook(settings, webhookUrl, config.webhookSecret));
  checks.push(...(await checkPrices(paddle)));
  return checks;
}

/**
 * The default payment link, without which Paddle refuses to create any
 * transaction (`transaction_default_checkout_url_not_set`). The checkout
 * settings endpoint is not in the SDK: one GET on the environment's host.
 */
async function checkDefaultPaymentLink(config: PaddleConfig): Promise<DoctorCheck> {
  const name = "default payment link";
  const setFix =
    `Set it at ${CHECKOUT_SETTINGS_PAGE} > Default payment link. Sandbox: any https URL of yours, the tunnel's /pricing included. ` +
    "Production: only a domain approved under Paddle > Checkout > Website approval, so it can be set only after the domain review.";
  let response: Response;
  try {
    response = await fetch(`${paddleBaseUrl(config.environment)}/settings/checkout-url`, {
      headers: { Authorization: `Bearer ${config.apiKey}`, "Paddle-Version": "1" },
      signal: AbortSignal.timeout(PADDLE_CALL_TIMEOUT_MS),
    });
  } catch (error) {
    return fail(name, `the checkout settings could not be read: ${error instanceof Error ? error.name : String(error)}`, "Check the network and run the doctor again.");
  }
  if (response.status === 403) {
    return fail(
      name,
      "the API key lacks checkout_settings.read, so the link cannot be verified here",
      `${grantFix("checkout_settings.read")} Or check by hand: ${CHECKOUT_SETTINGS_PAGE} > Default payment link must be set.`,
    );
  }
  if (!response.ok) return fail(name, `the checkout settings answered HTTP ${response.status}`, "Run the doctor again; if it persists, check Paddle's status page.");
  const body = (await response.json().catch(() => null)) as { data?: { default_url?: string | null } } | null;
  const url = body?.data?.default_url ?? null;
  if (!url) return fail(name, "not set: Paddle refuses every transaction until it is (transaction_default_checkout_url_not_set)", setFix);
  return pass(name, `set to ${url}`);
}

/** The route every destination of ours points at. */
const WEBHOOK_PATH = /\/api\/webhooks\/paddle$/;

function checkWebhook(settings: NotificationSettings[] | null, webhookUrl: string | null, secret: string | null): DoctorCheck[] {
  const name = "webhook destination";
  if (!settings) return [skip(name, "not checked: the destinations could not be listed (see notification_setting.read)")];

  const found =
    settings.find((setting) => setting.description === WEBHOOK_DESCRIPTION) ??
    (webhookUrl ? settings.find((setting) => setting.destination === webhookUrl) : undefined) ??
    settings.find((setting) => WEBHOOK_PATH.test(setting.destination)) ??
    null;
  const syncFix = `Run npm run billing:sync -- --webhook-url ${webhookUrl ?? "https://<host>/api/webhooks/paddle"} and paste the secret it prints into PADDLE_WEBHOOK_SECRET.`;
  if (!found) return [fail(name, "none exists: Paddle delivers no events, so no purchase ever reaches the app", syncFix)];

  const out: DoctorCheck[] = [];
  const problems: string[] = [];
  if (webhookUrl && found.destination !== webhookUrl) problems.push(`points at ${found.destination}, wanted ${webhookUrl}`);
  if (!found.active) problems.push("it is inactive");
  const subscribed = new Set(found.subscribedEvents.map((event) => event.name));
  const missing = SUBSCRIBED_EVENTS.filter((event) => !subscribed.has(event));
  if (missing.length) problems.push(`missing events ${missing.join(", ")}`);
  const where = `${found.id} -> ${found.destination} (traffic ${found.trafficSource}, ${found.active ? "active" : "INACTIVE"})`;
  out.push(
    problems.length
      ? fail(name, `${where}: ${problems.join("; ")}`, syncFix)
      : pass(name, `${where}, every event the webhook handles${found.trafficSource === "all" ? "" : "; traffic is not \"all\", so the webhook simulator will not reach it (real deliveries do)"}`),
  );

  const twins = settings.filter((setting) => setting !== found && WEBHOOK_PATH.test(setting.destination));
  if (twins.length) {
    out.push(
      fail(
        "webhook destinations",
        `${twins.length + 1} destinations point at the route (${[found, ...twins].map((setting) => setting.id).join(", ")}): every event would arrive that many times`,
        "Keep one (the one whose secret is in PADDLE_WEBHOOK_SECRET) and delete the others at Paddle > Developer tools > Notifications.",
      ),
    );
  }

  const secretName = "webhook secret";
  if (!secret) out.push(fail(secretName, "PADDLE_WEBHOOK_SECRET is not set: every delivery is answered 500", syncFix));
  else if (!found.endpointSecretKey) out.push(skip(secretName, "the destination's secret is not returned on read, so it cannot be compared", "If deliveries are rejected with 400, re-paste the secret from Paddle > Developer tools > Notifications."));
  else if (found.endpointSecretKey !== secret) out.push(fail(secretName, "PADDLE_WEBHOOK_SECRET is not this destination's secret: every delivery is rejected with 400", `Paste the secret of ${found.id} (Paddle > Developer tools > Notifications, or what billing:sync printed) into PADDLE_WEBHOOK_SECRET.`));
  else out.push(pass(secretName, `PADDLE_WEBHOOK_SECRET matches ${found.id}`));
  return out;
}

async function checkPrices(paddle: ReturnType<typeof paddleClient>): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  const syncFix = "Run npm run billing:sync and paste the price ids it prints into .env.";
  for (const key of CHECKOUT_ITEMS) {
    const name = `price ${key}`;
    const wanted = CATALOG[key];
    const envName = PRICE_ID_ENV[key];
    const id = process.env[envName]?.trim();
    if (!id) {
      out.push(fail(name, `${envName} is not set`, syncFix));
      continue;
    }
    try {
      const price = await paddle.prices.get(id);
      const problems: string[] = [];
      if (price.status !== "active") problems.push(`status ${price.status}`);
      if (price.unitPrice.amount !== wanted.amountMinor || price.unitPrice.currencyCode !== CATALOG_CURRENCY) {
        problems.push(`${price.unitPrice.amount} ${price.unitPrice.currencyCode}, catalog says ${wanted.amountMinor} ${CATALOG_CURRENCY}`);
      }
      const interval = price.billingCycle?.interval ?? null;
      if (interval !== wanted.interval) problems.push(`billing cycle ${interval ?? "one-time"}, catalog says ${wanted.interval ?? "one-time"}`);
      if (price.customData?.key !== key) problems.push(`its key is ${JSON.stringify(price.customData?.key ?? null)}, not ${key}`);
      out.push(
        problems.length
          ? fail(name, `${id}: ${problems.join("; ")}`, syncFix)
          : pass(name, `${id}: ${price.unitPrice.amount} ${price.unitPrice.currencyCode} ${interval ? `per ${interval}` : "one-time"}, active`),
      );
    } catch (error) {
      out.push(error instanceof ApiError && error.code !== PADDLE_FORBIDDEN ? fail(name, `${id}: ${error.code}`, syncFix) : failFrom(name, "price.read", error));
    }
  }
  return out;
}
