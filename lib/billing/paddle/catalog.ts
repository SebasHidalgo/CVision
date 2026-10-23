import { BRAND } from "@/lib/brand";
import "server-only";

import type { IEventName, NotificationSettings, Price, Product } from "@paddle/paddle-node-sdk";
import { CATALOG, CATALOG_CURRENCY, type CatalogProduct } from "@/lib/billing/catalog";
import { CHECKOUT_ITEMS, type CatalogSyncReport, type PriceKey } from "@/lib/billing/types";
import { PADDLE_FORBIDDEN, paddleCall, paddleClient, paddleErrorCode } from "./client";

/**
 * Pushes the catalog as code to Paddle, idempotently: products and prices
 * are found by the `key` in their custom data and created or updated to
 * match; the webhook destination is found by its description and created or
 * updated to the URL and the events the app handles. Nothing is archived:
 * a key removed from the catalog is a decision to take by hand. Reads
 * everything back for the script to print.
 */

/** How a destination of ours is recognised among the account's. */
export const WEBHOOK_DESCRIPTION = BRAND.name;

/** The events the webhook route applies; the rest are not even delivered. */
export const SUBSCRIBED_EVENTS: IEventName[] = [
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.trialing",
  "transaction.completed",
  "adjustment.created",
  "adjustment.updated",
];

/** Both products are access to the same software service. */
const TAX_CATEGORY = "saas";

/** One of each per checkout: the pack grants its credits per unit, but the page sells one. */
const QUANTITY = { minimum: 1, maximum: 1 };

const LIST_PAGE = 200;

export async function syncPaddleCatalog({ webhookUrl }: { webhookUrl: string | null }): Promise<CatalogSyncReport> {
  const paddle = paddleClient();
  const report: CatalogSyncReport = {
    products: [],
    prices: [],
    webhook: { id: "", action: "skipped", destination: null, events: [], secret: null, trafficSource: null, active: null },
  };

  const existingProducts = await paddleCall("product list", async () => {
    const out: Product[] = [];
    for await (const product of paddle.products.list({ status: ["active"], perPage: LIST_PAGE })) out.push(product);
    return out;
  });

  for (const key of CHECKOUT_ITEMS) {
    const wanted = CATALOG[key];
    const found = existingProducts.find((product) => product.customData?.key === key) ?? null;

    let product: Product;
    let action: "created" | "updated" | "unchanged";
    if (!found) {
      product = await paddleCall(`product create ${key}`, () =>
        paddle.products.create({
          name: wanted.name,
          description: wanted.description,
          taxCategory: TAX_CATEGORY,
          customData: { key },
        }),
      );
      action = "created";
    } else if (productDiffers(found, wanted)) {
      product = await paddleCall(`product update ${key}`, () =>
        paddle.products.update(found.id, {
          name: wanted.name,
          description: wanted.description,
          taxCategory: TAX_CATEGORY,
          status: "active",
        }),
      );
      action = "updated";
    } else {
      product = found;
      action = "unchanged";
    }
    report.products.push({
      key,
      productId: product.id,
      action,
      name: product.name,
      description: product.description,
      taxCategory: product.taxCategory,
    });

    const price = await syncPrice(paddle, product.id, wanted);
    report.prices.push(price);
  }

  report.webhook = await syncWebhook(paddle, webhookUrl);
  return report;
}

type PaddleSdk = ReturnType<typeof paddleClient>;

async function syncPrice(paddle: PaddleSdk, productId: string, wanted: CatalogProduct): Promise<CatalogSyncReport["prices"][number]> {
  const existing = await paddleCall(`price list ${wanted.key}`, async () => {
    const out: Price[] = [];
    for await (const price of paddle.prices.list({ productId: [productId], status: ["active"], perPage: LIST_PAGE })) {
      out.push(price);
    }
    return out;
  });
  const found = existing.find((price) => price.customData?.key === wanted.key) ?? null;

  const body = {
    description: wanted.interval ? `${wanted.name}, monthly` : `${wanted.name}, one-time`,
    name: wanted.interval ? "Monthly" : "One-time",
    unitPrice: { amount: wanted.amountMinor, currencyCode: CATALOG_CURRENCY },
    billingCycle: wanted.interval ? { interval: wanted.interval, frequency: 1 } : null,
    quantity: QUANTITY,
    taxMode: "account_setting" as const,
  };

  let price: Price;
  let action: "created" | "updated" | "unchanged";
  if (!found) {
    price = await paddleCall(`price create ${wanted.key}`, () =>
      paddle.prices.create({ ...body, productId, customData: { key: wanted.key } }),
    );
    action = "created";
  } else if (priceDiffers(found, body)) {
    price = await paddleCall(`price update ${wanted.key}`, () => paddle.prices.update(found.id, { ...body, status: "active" }));
    action = "updated";
  } else {
    price = found;
    action = "unchanged";
  }

  return {
    key: wanted.key,
    priceId: price.id,
    action,
    amountMinor: price.unitPrice.amount,
    currency: price.unitPrice.currencyCode,
    interval: price.billingCycle ? `${price.billingCycle.frequency} ${price.billingCycle.interval}` : null,
    quantity: { minimum: price.quantity.minimum, maximum: price.quantity.maximum },
  };
}

/**
 * The destination is recognised by its description or, failing that, by
 * its URL: one the owner made by hand in the dashboard is ours as long as
 * it points at our route, and is left under its own name. An API key that
 * may not create or update destinations (Paddle answers `forbidden`) does
 * not fail the sync: the report says so and what to do by hand.
 */
async function syncWebhook(paddle: PaddleSdk, webhookUrl: string | null): Promise<CatalogSyncReport["webhook"]> {
  const settings = await paddleCall("notification settings list", () => paddle.notificationSettings.list());
  const found =
    settings.find((setting) => setting.description === WEBHOOK_DESCRIPTION) ??
    (webhookUrl ? settings.find((setting) => setting.destination === webhookUrl) : undefined) ??
    settings.find((setting) => WEBHOOK_PATH.test(setting.destination)) ??
    null;

  const describe = (
    setting: NotificationSettings,
    action: CatalogSyncReport["webhook"]["action"],
    note?: string,
  ): CatalogSyncReport["webhook"] => ({
    id: setting.id,
    action,
    destination: setting.destination,
    events: setting.subscribedEvents.map((event) => event.name),
    secret: setting.endpointSecretKey || null,
    trafficSource: setting.trafficSource,
    active: setting.active,
    ...(note ? { note } : {}),
  });

  if (!webhookUrl) {
    return found
      ? describe(found, "unchanged")
      : { id: "", action: "skipped", destination: null, events: [], secret: null, trafficSource: null, active: null };
  }

  if (!found) {
    try {
      const created = await paddleCall("notification setting create", () =>
        paddle.notificationSettings.create({
          description: WEBHOOK_DESCRIPTION,
          destination: webhookUrl,
          type: "url",
          apiVersion: 1,
          includeSensitiveFields: false,
          // "all": the simulator's deliveries reach the route too.
          trafficSource: "all",
          subscribedEvents: SUBSCRIBED_EVENTS,
        }),
      );
      return describe(created, "created");
    } catch (error) {
      if (paddleErrorCode(error) !== PADDLE_FORBIDDEN) throw error;
      return {
        id: "",
        action: "forbidden",
        destination: webhookUrl,
        events: [...SUBSCRIBED_EVENTS],
        secret: null,
        trafficSource: null,
        active: null,
        note: forbiddenNote("create", [`destination ${webhookUrl}`, `events ${SUBSCRIBED_EVENTS.join(", ")}`, 'traffic source "all"']),
      };
    }
  }

  const currentEvents = new Set(found.subscribedEvents.map((event) => event.name));
  const missingEvents = SUBSCRIBED_EVENTS.filter((name) => !currentEvents.has(name));
  const differences = [
    ...(found.destination === webhookUrl ? [] : [`destination is ${found.destination}, wanted ${webhookUrl}`]),
    ...(found.active ? [] : ["it is inactive"]),
    ...(missingEvents.length ? [`missing events ${missingEvents.join(", ")}`] : []),
  ];
  if (differences.length === 0) {
    // "all" only matters for the simulator; a hand-made "platform" destination is not wrong.
    const hint = found.trafficSource === "all" ? undefined : 'traffic source is not "all": the webhook simulator will not reach it (real deliveries do)';
    return describe(found, "unchanged", hint);
  }

  try {
    const updated = await paddleCall("notification setting update", () =>
      paddle.notificationSettings.update(found.id, {
        destination: webhookUrl,
        active: true,
        trafficSource: "all",
        subscribedEvents: SUBSCRIBED_EVENTS,
      }),
    );
    return describe(updated, "updated");
  } catch (error) {
    if (paddleErrorCode(error) !== PADDLE_FORBIDDEN) throw error;
    return describe(found, "forbidden", forbiddenNote("update", differences));
  }
}

/** The route every destination of ours points at. */
const WEBHOOK_PATH = new RegExp("/api/webhooks/paddle$");

function forbiddenNote(verb: "create" | "update", items: string[]): string {
  return `the API key may not ${verb} notification settings (Paddle answered "forbidden"). Either give the key write access to notification settings (Paddle > Developer tools > Authentication) and run the sync again, or ${verb} the destination by hand (Paddle > Developer tools > Notifications): ${items.join("; ")}.`;
}

/** Exported for the test of the decision, with the SDK stubbed. */
export function productDiffers(found: Pick<Product, "name" | "description" | "taxCategory">, wanted: CatalogProduct): boolean {
  return found.name !== wanted.name || found.description !== wanted.description || found.taxCategory !== TAX_CATEGORY;
}

export function priceDiffers(
  found: Pick<Price, "description" | "unitPrice" | "billingCycle" | "quantity">,
  body: {
    description: string;
    unitPrice: { amount: string; currencyCode: string };
    billingCycle: { interval: string; frequency: number } | null;
    quantity: { minimum: number; maximum: number };
  },
): boolean {
  const cycleDiffers =
    (found.billingCycle === null) !== (body.billingCycle === null) ||
    (found.billingCycle !== null &&
      body.billingCycle !== null &&
      (found.billingCycle.interval !== body.billingCycle.interval || found.billingCycle.frequency !== body.billingCycle.frequency));
  return (
    found.description !== body.description ||
    found.unitPrice.amount !== body.unitPrice.amount ||
    found.unitPrice.currencyCode !== body.unitPrice.currencyCode ||
    cycleDiffers ||
    found.quantity.minimum !== body.quantity.minimum ||
    found.quantity.maximum !== body.quantity.maximum
  );
}

export type { PriceKey };
