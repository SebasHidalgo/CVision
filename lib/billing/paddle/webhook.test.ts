import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAndParsePaddleWebhook, WebhookRejectedError } from "./webhook";
import { signPaddleWebhook } from "./webhookSignature";

const SECRET = "pdl_ntfset_test_secret_0123456789";
const PRO_PRICE = "pri_pro_test";
const PACK_PRICE = "pri_pack_test";

beforeEach(() => {
  vi.stubEnv("PADDLE_ENV", "sandbox");
  vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_apikey_test0000000000000000");
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("PADDLE_PRICE_PRO_MONTHLY", PRO_PRICE);
  vi.stubEnv("PADDLE_PRICE_INTERVIEW_PACK", PACK_PRICE);
});

/** A price as Paddle embeds it in items, snake_case, enough for the SDK's constructors. */
const price = (id: string, recurring: boolean) => ({
  id,
  product_id: "pro_1",
  description: "x",
  name: null,
  type: "standard",
  billing_cycle: recurring ? { interval: "month", frequency: 1 } : null,
  trial_period: null,
  tax_mode: "account_setting",
  unit_price: { amount: recurring ? "1500" : "900", currency_code: "USD" },
  unit_price_overrides: [],
  quantity: { minimum: 1, maximum: 1 },
  status: "active",
  custom_data: null,
  import_meta: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

const subscriptionData = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_01",
  status: "active",
  customer_id: "ctm_01",
  address_id: "add_01",
  business_id: null,
  currency_code: "USD",
  created_at: "2026-10-20T10:00:00Z",
  updated_at: "2026-10-20T10:00:05Z",
  started_at: "2026-10-20T10:00:00Z",
  first_billed_at: "2026-10-20T10:00:00Z",
  next_billed_at: "2026-11-20T10:00:00Z",
  paused_at: null,
  canceled_at: null,
  discount: null,
  collection_mode: "automatic",
  billing_details: null,
  current_billing_period: { starts_at: "2026-10-20T10:00:00Z", ends_at: "2026-11-20T10:00:00Z" },
  billing_cycle: { interval: "month", frequency: 1 },
  scheduled_change: null,
  items: [
    {
      status: "active",
      quantity: 1,
      recurring: true,
      created_at: "2026-10-20T10:00:00Z",
      updated_at: "2026-10-20T10:00:00Z",
      previously_billed_at: "2026-10-20T10:00:00Z",
      next_billed_at: "2026-11-20T10:00:00Z",
      trial_dates: null,
      price: price(PRO_PRICE, true),
      product: null,
    },
  ],
  custom_data: { userId: "user_1" },
  import_meta: null,
  ...overrides,
});

const envelope = (eventType: string, data: unknown, eventId = "evt_01") =>
  JSON.stringify({ event_id: eventId, event_type: eventType, occurred_at: "2026-10-20T10:00:06Z", notification_id: "ntf_01", data });

const headers = (signature?: string) => new Headers(signature ? { "paddle-signature": signature } : {});

describe("verification", () => {
  it("accepts a delivery signed with the destination's secret", async () => {
    const body = envelope("subscription.updated", subscriptionData());
    const event = await verifyAndParsePaddleWebhook(body, headers(signPaddleWebhook(body, SECRET)));
    expect(event).toMatchObject({ eventId: "evt_01", type: "subscription.updated", kind: "subscription" });
  });

  it("rejects a bad signature, an altered body and a missing header, with a plain error", async () => {
    const body = envelope("subscription.updated", subscriptionData());
    await expect(verifyAndParsePaddleWebhook(body, headers(signPaddleWebhook(body, "other-secret")))).rejects.toBeInstanceOf(WebhookRejectedError);
    await expect(verifyAndParsePaddleWebhook(body.replace("sub_01", "sub_02"), headers(signPaddleWebhook(body, SECRET)))).rejects.toBeInstanceOf(WebhookRejectedError);
    await expect(verifyAndParsePaddleWebhook(body, headers())).rejects.toBeInstanceOf(WebhookRejectedError);
  });

  it("rejects a timestamp older than the SDK's five-second window", async () => {
    const body = envelope("subscription.updated", subscriptionData());
    const stale = signPaddleWebhook(body, SECRET, Math.floor(Date.now() / 1000) - 6);
    await expect(verifyAndParsePaddleWebhook(body, headers(stale))).rejects.toBeInstanceOf(WebhookRejectedError);
  });

  it("is an operator error, not a rejection, when the secret is not configured", async () => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    const body = envelope("subscription.updated", subscriptionData());
    await expect(verifyAndParsePaddleWebhook(body, headers(signPaddleWebhook(body, SECRET)))).rejects.toMatchObject({ code: "BILLING_MISCONFIGURED" });
  });
});

async function parse(eventType: string, data: unknown) {
  const body = envelope(eventType, data);
  return verifyAndParsePaddleWebhook(body, headers(signPaddleWebhook(body, SECRET)));
}

describe("translation", () => {
  it("reduces a subscription event to the neutral shape: status, period, price key, user hint, provider time", async () => {
    const event = await parse("subscription.created", subscriptionData());
    expect(event).toEqual({
      eventId: "evt_01",
      type: "subscription.created",
      occurredAt: new Date("2026-10-20T10:00:06Z"),
      kind: "subscription",
      subscription: {
        providerSubscriptionId: "sub_01",
        providerCustomerId: "ctm_01",
        status: "active",
        priceKey: "pro_monthly",
        currentPeriodStart: new Date("2026-10-20T10:00:00Z"),
        currentPeriodEnd: new Date("2026-11-20T10:00:00Z"),
        cancelAtPeriodEnd: false,
        scheduledChangeAt: null,
        canceledAt: null,
        providerUpdatedAt: new Date("2026-10-20T10:00:05Z"),
        userIdHint: "user_1",
      },
    });
  });

  it("reads a scheduled cancellation, a canceled subscription without a period, and an unknown price", async () => {
    const scheduled = await parse(
      "subscription.updated",
      subscriptionData({ scheduled_change: { action: "cancel", effective_at: "2026-11-20T10:00:00Z", resume_at: null }, next_billed_at: null }),
    );
    expect(scheduled.kind === "subscription" && scheduled.subscription).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: true,
      scheduledChangeAt: new Date("2026-11-20T10:00:00Z"),
    });

    const paused = await parse("subscription.paused", subscriptionData({ scheduled_change: { action: "resume", effective_at: "2026-12-01T00:00:00Z", resume_at: "2026-12-01T00:00:00Z" } }));
    expect(paused.kind === "subscription" && paused.subscription).toMatchObject({ cancelAtPeriodEnd: false, scheduledChangeAt: new Date("2026-12-01T00:00:00Z") });

    const canceled = await parse(
      "subscription.canceled",
      subscriptionData({ status: "canceled", canceled_at: "2026-11-20T10:00:00Z", current_billing_period: null, custom_data: null, items: [{ ...subscriptionData().items[0], price: price("pri_someone_elses", true) }] }),
    );
    expect(canceled.kind === "subscription" && canceled.subscription).toMatchObject({
      status: "canceled",
      canceledAt: new Date("2026-11-20T10:00:00Z"),
      currentPeriodStart: null,
      currentPeriodEnd: null,
      priceKey: null,
      userIdHint: null,
    });
  });

  it("reduces a completed transaction to its items' price keys, customer, subscription and user hint", async () => {
    const event = await parse("transaction.completed", {
      id: "txn_01",
      status: "completed",
      customer_id: "ctm_01",
      address_id: "add_01",
      business_id: null,
      custom_data: { userId: "user_1" },
      currency_code: "USD",
      origin: "web",
      subscription_id: null,
      invoice_id: "inv_01",
      invoice_number: "1",
      collection_mode: "automatic",
      discount_id: null,
      billing_details: null,
      billing_period: null,
      items: [{ price: price(PACK_PRICE, false), quantity: 1, proration: null }],
      details: null,
      payments: [],
      checkout: { url: null },
      created_at: "2026-10-20T10:00:00Z",
      updated_at: "2026-10-20T10:00:05Z",
      billed_at: "2026-10-20T10:00:05Z",
      revised_at: null,
    });
    expect(event).toMatchObject({
      kind: "transaction-completed",
      transactionId: "txn_01",
      providerCustomerId: "ctm_01",
      providerSubscriptionId: null,
      userIdHint: "user_1",
      items: [{ priceKey: "interview_pack", quantity: 1 }],
    });
  });

  it("reduces an adjustment to its action, status, transaction and whether it is the whole of it", async () => {
    const adjustment = (action: string, status: string, type: string) => ({
      id: "adj_01",
      action,
      type,
      transaction_id: "txn_01",
      subscription_id: null,
      customer_id: "ctm_01",
      reason: "requested",
      credit_applied_to_balance: false,
      currency_code: "USD",
      status,
      items: [],
      totals: { subtotal: "900", tax: "0", total: "900", fee: "0", earnings: "0", currency_code: "USD" },
      payout_totals: null,
      created_at: "2026-10-21T10:00:00Z",
      updated_at: "2026-10-21T10:00:00Z",
    });
    expect(await parse("adjustment.created", adjustment("refund", "pending_approval", "full"))).toMatchObject({
      kind: "adjustment",
      adjustmentId: "adj_01",
      transactionId: "txn_01",
      action: "refund",
      status: "pending_approval",
      full: true,
    });
    expect(await parse("adjustment.updated", adjustment("chargeback_warning", "approved", "partial"))).toMatchObject({ action: "chargeback", full: false });
    expect(await parse("adjustment.updated", adjustment("credit_reverse", "approved", "full"))).toMatchObject({ action: "other" });
  });

  it("records anything else as ignored, with its type", async () => {
    const event = await parse("customer.created", {
      id: "ctm_01",
      name: null,
      email: "someone@example.com",
      marketing_consent: false,
      status: "active",
      custom_data: null,
      locale: "en",
      created_at: "2026-10-20T10:00:00Z",
      updated_at: "2026-10-20T10:00:00Z",
      import_meta: null,
    });
    expect(event).toEqual({ eventId: "evt_01", type: "customer.created", occurredAt: new Date("2026-10-20T10:00:06Z"), kind: "ignored" });
  });
});
