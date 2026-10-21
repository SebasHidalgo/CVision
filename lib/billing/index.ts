import "server-only";

import {
  applySubscriptionSnapshot,
  findBillingCustomer,
  listSubscriptionRows,
} from "@/lib/database/billing";
import { NoBillingAccountError } from "@/lib/error/errors";
import { paddleAdapter } from "./paddle/adapter";
import type {
  BillingProviderAdapter,
  CatalogSyncReport,
  CheckoutItem,
  CheckoutSession,
  ParsedBillingEvent,
  PortalSession,
  ProviderSubscription,
} from "./types";

/**
 * What the app may ask of billing, in the app's words. One provider sits
 * behind it; a forced change of provider is a new adapter in its own folder
 * and the one line below, not a phase. Eligibility (who may buy what) is the
 * action's business; the mapping from a user to the provider's customer is
 * this module's, through the database.
 */

const provider: BillingProviderAdapter = paddleAdapter;

const LOG = "[CVision][billing]";

/** A transaction for `item`, attached to the user, for the browser to open. */
export async function createCheckout(userId: string, item: CheckoutItem): Promise<CheckoutSession> {
  const customer = await findBillingCustomer(userId);
  return provider.createTransaction({
    priceKey: item,
    userId,
    providerCustomerId: customer?.providerCustomerId ?? null,
  });
}

/** A link into the provider's portal (payment method, invoices, cancel). */
export async function createPortalSession(userId: string): Promise<PortalSession> {
  const customer = await findBillingCustomer(userId);
  if (!customer) throw new NoBillingAccountError();
  const subscriptions = await listSubscriptionRows(userId);
  return provider.createPortalSession({
    providerCustomerId: customer.providerCustomerId,
    providerSubscriptionIds: subscriptions.map((subscription) => subscription.providerSubscriptionId),
  });
}

export type CancelNowResult = {
  /** Provider ids canceled, or already canceled, by this call. */
  canceled: string[];
  /** Provider ids the provider would not cancel; each is logged with the user id. */
  failed: string[];
};

/**
 * Cancels every subscription of the user that is not already canceled,
 * effective immediately, and mirrors the answers. For the account deletion:
 * a subscription that keeps billing a deleted user is the worst outcome of
 * billing, so a failure here is loud but does not stop the deletion.
 */
export async function cancelSubscriptionNow(userId: string): Promise<CancelNowResult> {
  const result: CancelNowResult = { canceled: [], failed: [] };
  const rows = await listSubscriptionRows(userId);
  for (const row of rows) {
    if (row.status === "CANCELED") {
      result.canceled.push(row.providerSubscriptionId);
      continue;
    }
    try {
      const snapshot = await provider.cancelSubscriptionNow(row.providerSubscriptionId);
      await applySubscriptionSnapshot(userId, snapshot);
      result.canceled.push(row.providerSubscriptionId);
    } catch (error) {
      console.error(
        `${LOG} user=${userId} subscription=${row.providerSubscriptionId} NOT canceled at the provider; cancel it by hand:`,
        error instanceof Error ? `${error.name}: ${error.message}` : error,
      );
      result.failed.push(row.providerSubscriptionId);
    }
  }
  return result;
}

export function verifyAndParseWebhook(rawBody: string, headers: Headers): Promise<ParsedBillingEvent> {
  return provider.verifyAndParseWebhook(rawBody, headers);
}

export function syncCatalog(options: { webhookUrl: string | null }): Promise<CatalogSyncReport> {
  return provider.syncCatalog(options);
}

/** The provider's view of a customer's subscriptions, for the reconcile. */
export function listProviderSubscriptions(providerCustomerId: string): Promise<ProviderSubscription[]> {
  return provider.listSubscriptions(providerCustomerId);
}
