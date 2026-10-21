import "server-only";

import {
  NodeRuntime,
  Webhooks,
  type AdjustmentNotification,
  type EventEntity,
  type SubscriptionNotification,
  type TransactionNotification,
} from "@paddle/paddle-node-sdk";
import {
  WebhookRejectedError,
  type AdjustmentAction,
  type ParsedBillingEvent,
  type ProviderSubscription,
  type ProviderSubscriptionStatus,
} from "@/lib/billing/types";
import { BillingMisconfiguredError } from "@/lib/error/errors";
import { readPaddleConfig } from "./client";
import { userIdFromCustomData } from "./customData";
import { priceKeyOf } from "./prices";

/**
 * Verifies a Paddle delivery and translates it. The SDK checks the HMAC of
 * `ts:rawBody` against the destination's secret and rejects a `ts` older
 * than five seconds (hard-coded there; Paddle's own recommendation). A
 * missing secret is an operator error; a bad or missing signature is a
 * rejected delivery. Nothing of the payload survives past this file except
 * ids, statuses and times. The user id in the custom data counts only
 * when it carries the server's own signature (see customData.ts).
 */

export { WebhookRejectedError };

export const PADDLE_SIGNATURE_HEADER = "paddle-signature";

export async function verifyAndParsePaddleWebhook(
  rawBody: string,
  headers: Headers,
): Promise<ParsedBillingEvent> {
  const { webhookSecret } = readPaddleConfig();
  if (!webhookSecret) throw new BillingMisconfiguredError("PADDLE_WEBHOOK_SECRET is not set");

  const signature = headers.get(PADDLE_SIGNATURE_HEADER);
  if (!signature) throw new WebhookRejectedError("Missing Paddle-Signature header");

  let event: EventEntity;
  try {
    // The SDK's HMAC needs its runtime, which only the `Paddle` constructor
    // installs; without this a bare `Webhooks` silently fails every check.
    NodeRuntime.initialize();
    event = await new Webhooks().unmarshal(rawBody, webhookSecret, signature);
  } catch {
    // The SDK's message names which check failed; none of it is kept.
    throw new WebhookRejectedError();
  }

  return translate(event);
}

/** The SDK's event into the app's shape; exported for the simulator and tests that build events by hand. */
export function translate(event: EventEntity): ParsedBillingEvent {
  const base = { eventId: event.eventId, type: event.eventType, occurredAt: new Date(event.occurredAt) };

  if (event.eventType.startsWith("subscription.")) {
    return { ...base, kind: "subscription", subscription: toProviderSubscription(event.data as SubscriptionNotification) };
  }
  if (event.eventType === "transaction.completed") {
    const data = event.data as TransactionNotification;
    return {
      ...base,
      kind: "transaction-completed",
      transactionId: data.id,
      providerCustomerId: data.customerId,
      providerSubscriptionId: data.subscriptionId,
      userIdHint: userIdFromCustomData(data.customData),
      items: data.items.map((item) => ({ priceKey: priceKeyOf(item.price?.id), quantity: item.quantity })),
    };
  }
  if (event.eventType.startsWith("adjustment.")) {
    const data = event.data as AdjustmentNotification;
    return {
      ...base,
      kind: "adjustment",
      adjustmentId: data.id,
      transactionId: data.transactionId,
      providerSubscriptionId: data.subscriptionId,
      providerCustomerId: data.customerId,
      action: adjustmentAction(data.action),
      status: data.status,
      full: data.type === "full",
    };
  }
  return { ...base, kind: "ignored" };
}

/** The fields a subscription has whether it arrives in a webhook or from the API. */
export type PaddleSubscriptionLike = Pick<
  SubscriptionNotification,
  "id" | "customerId" | "status" | "currentBillingPeriod" | "scheduledChange" | "canceledAt" | "updatedAt" | "customData"
> & { items: Array<{ status: string; price: { id: string } | null }> };

export function toProviderSubscription(data: PaddleSubscriptionLike): ProviderSubscription {
  const priced = data.items.find((item) => item.status !== "inactive") ?? data.items[0];
  const scheduledCancel = data.scheduledChange?.action === "cancel" ? data.scheduledChange : null;
  return {
    providerSubscriptionId: data.id,
    providerCustomerId: data.customerId,
    status: data.status as ProviderSubscriptionStatus,
    priceKey: priceKeyOf(priced?.price?.id),
    currentPeriodStart: dateOrNull(data.currentBillingPeriod?.startsAt),
    currentPeriodEnd: dateOrNull(data.currentBillingPeriod?.endsAt),
    cancelAtPeriodEnd: scheduledCancel !== null,
    scheduledChangeAt: dateOrNull(data.scheduledChange?.effectiveAt),
    canceledAt: dateOrNull(data.canceledAt),
    providerUpdatedAt: new Date(data.updatedAt),
    userIdHint: userIdFromCustomData(data.customData),
  };
}

function adjustmentAction(action: string): AdjustmentAction {
  if (action === "refund") return "refund";
  if (action === "chargeback" || action === "chargeback_warning") return "chargeback";
  if (action === "credit") return "credit";
  return "other";
}

function dateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
