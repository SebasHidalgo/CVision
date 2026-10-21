import "server-only";

import type { Subscription } from "@paddle/paddle-node-sdk";
import type { BillingProviderAdapter, ProviderSubscription } from "@/lib/billing/types";
import { syncPaddleCatalog } from "./catalog";
import { paddleCall, paddleClient, paddleErrorCode } from "./client";
import { priceIdFor } from "./prices";
import { toProviderSubscription, verifyAndParsePaddleWebhook, type PaddleSubscriptionLike } from "./webhook";

/**
 * Paddle Billing behind the app's billing contract. Provider ids in,
 * provider ids out; the database is not touched here. The pieces: a
 * server-created transaction the browser opens with Paddle.js (so the
 * client never chooses the price or the payer), a customer-portal session,
 * an immediate cancel, the customer's subscriptions for the reconcile, the
 * webhook verifier and the catalog sync.
 */

const SUBSCRIPTIONS_PER_PAGE = 50;

export const paddleAdapter: BillingProviderAdapter = {
  async createTransaction({ priceKey, userId, providerCustomerId }) {
    const priceId = priceIdFor(priceKey);
    const paddle = paddleClient();
    const transaction = await paddleCall("transaction create", () =>
      paddle.transactions.create({
        items: [{ priceId, quantity: 1 }],
        // The server names the user; the first webhook event reads it back.
        customData: { userId },
        // Without a customer the transaction is a draft and the checkout
        // collects the email; with one, Paddle prefills and reuses it.
        ...(providerCustomerId ? { customerId: providerCustomerId } : {}),
      }),
    );
    return { transactionId: transaction.id };
  },

  async createPortalSession({ providerCustomerId, providerSubscriptionIds }) {
    const paddle = paddleClient();
    const session = await paddleCall("portal session", () =>
      paddle.customerPortalSessions.create(providerCustomerId, providerSubscriptionIds),
    );
    return { url: session.urls.general.overview };
  },

  async cancelSubscriptionNow(providerSubscriptionId) {
    const paddle = paddleClient();
    try {
      const canceled = await paddleCall("subscription cancel", () =>
        paddle.subscriptions.cancel(providerSubscriptionId, { effectiveFrom: "immediately" }),
      );
      return toProviderSubscription(asLike(canceled));
    } catch (error) {
      // Already canceled (or paused and canceled since): the current state is the answer.
      const code = paddleErrorCode(error);
      if (!code) throw error;
      const current = await paddleCall("subscription read", () => paddle.subscriptions.get(providerSubscriptionId));
      if (current.status === "canceled") return toProviderSubscription(asLike(current));
      throw error;
    }
  },

  async listSubscriptions(providerCustomerId) {
    const paddle = paddleClient();
    const out: ProviderSubscription[] = [];
    await paddleCall("subscription list", async () => {
      const page = paddle.subscriptions.list({ customerId: [providerCustomerId], perPage: SUBSCRIPTIONS_PER_PAGE });
      for await (const subscription of page) out.push(toProviderSubscription(asLike(subscription)));
    });
    return out;
  },

  verifyAndParseWebhook: verifyAndParsePaddleWebhook,

  syncCatalog: syncPaddleCatalog,
};

/** The API entity has the same fields as the notification where it matters; only the item shape differs in name. */
function asLike(subscription: Subscription): PaddleSubscriptionLike {
  return {
    id: subscription.id,
    customerId: subscription.customerId,
    status: subscription.status,
    currentBillingPeriod: subscription.currentBillingPeriod,
    scheduledChange: subscription.scheduledChange,
    canceledAt: subscription.canceledAt,
    updatedAt: subscription.updatedAt,
    customData: subscription.customData,
    items: subscription.items.map((item) => ({ status: item.status, price: item.price ? { id: item.price.id } : null })),
  };
}
