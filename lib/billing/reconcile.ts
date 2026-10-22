import "server-only";

import {
  applySubscriptionSnapshot,
  claimSubscriptionReconcile,
  findBillingCustomer,
  type SnapshotOutcome,
} from "@/lib/database/billing";
import { grantInterviewCredits } from "@/lib/database/credits";
import { ACCESS_BY_STATUS, type PlanStanding, type SubscriptionStanding } from "./access";
import { CATALOG } from "./catalog";
import { listProviderSubscriptions, listProviderTransactions } from "./index";

/**
 * The repair for a lost webhook: the provider's list of the customer's
 * subscriptions, pushed through the same mirror write the webhook uses
 * (so ordering by the provider's time still applies). Two callers: the
 * script, for any user on demand, and the lazy path, which runs only when
 * the mirror looks behind the provider and at most once per interval per
 * subscription, so the pages that read a plan never hammer the API.
 */

const LOG = "[CVision][billing]";

/** How long past a period's end, or a scheduled change, before the mirror is doubted. */
export const RECONCILE_STALE_GRACE_MS = 60 * 60_000;
/** The least time between two lazy pulls for one subscription. */
export const SUBSCRIPTION_RECONCILE_MIN_INTERVAL_MS = 10 * 60_000;

export type ReconcileResult = {
  /** False when the user never checked out: nothing to pull. */
  customer: boolean;
  subscriptions: number;
  outcomes: Record<SnapshotOutcome, number>;
};

export async function reconcileUserSubscriptions(userId: string, now = new Date()): Promise<ReconcileResult> {
  const result: ReconcileResult = { customer: false, subscriptions: 0, outcomes: { created: 0, applied: 0, stale: 0, "no-user": 0 } };
  const customer = await findBillingCustomer(userId);
  if (!customer) return result;
  result.customer = true;

  const remote = await listProviderSubscriptions(customer.providerCustomerId);
  result.subscriptions = remote.length;
  for (const snapshot of remote) {
    const outcome = await applySubscriptionSnapshot(userId, snapshot);
    result.outcomes[outcome] += 1;
  }
  console.info(
    `${LOG} reconcile user=${userId} customer=${customer.providerCustomerId} subscriptions=${remote.length} created=${result.outcomes.created} applied=${result.outcomes.applied} stale=${result.outcomes.stale} at ${now.toISOString()}`,
  );
  return result;
}

export type BillingReconcileResult = ReconcileResult & {
  /** Completed transactions the provider lists for the customer. */
  transactions: number;
  /** Pack grants that were missing and were written now: paid and not delivered, repaired. */
  granted: number;
};

/**
 * Everything the provider knows about one user that a webhook may have
 * failed to deliver, for the "Check again" action and the script: the
 * subscriptions through the mirror, and every completed transaction with
 * a pack in it through the same grant the webhook makes, keyed by the
 * transaction id, so a pack already credited is left alone and a pack
 * whose event was lost is credited now. The units come from the catalog
 * as it stands, like the webhook's. Paid and not delivered is the worst
 * failure billing has; this is its repair.
 */
export async function reconcileUserBilling(userId: string, now = new Date()): Promise<BillingReconcileResult> {
  const subscriptions = await reconcileUserSubscriptions(userId, now);
  const result: BillingReconcileResult = { ...subscriptions, transactions: 0, granted: 0 };
  if (!subscriptions.customer) return result;

  const customer = await findBillingCustomer(userId);
  if (!customer) return result;
  const transactions = await listProviderTransactions(customer.providerCustomerId);
  result.transactions = transactions.length;
  for (const transaction of transactions) {
    const units = transaction.items.reduce((sum, item) => sum + item.quantity * (item.priceKey ? (CATALOG[item.priceKey].credits ?? 0) : 0), 0);
    if (units === 0) continue;
    const outcome = await grantInterviewCredits(userId, { units, transactionId: transaction.transactionId, now });
    if (outcome.granted) {
      result.granted += 1;
      console.warn(`${LOG} reconcile user=${userId} transaction=${transaction.transactionId}: ${units} credit(s) granted now (the completed event never arrived)`);
    }
  }
  return result;
}

/**
 * Whether the mirror looks behind the provider: an access-granting row whose
 * period ended more than the grace ago (a renewal's event was lost, and the
 * user's period would never roll over), or a scheduled cancellation that
 * should have landed (the canceled event was lost). A canceled or paused
 * row cannot go stale this way: nothing is expected of it.
 */
export function looksStale(subscription: SubscriptionStanding | null, now: Date): boolean {
  if (!subscription || !ACCESS_BY_STATUS[subscription.status]) return false;
  const since = (at: Date | null) => (at ? now.getTime() - at.getTime() : -Infinity);
  if (since(subscription.currentPeriodEnd) > RECONCILE_STALE_GRACE_MS) return true;
  if (subscription.cancelAtPeriodEnd && since(subscription.scheduledChangeAt) > RECONCILE_STALE_GRACE_MS) return true;
  return false;
}

/**
 * The lazy path: when the standing looks stale, take the subscription's
 * reconcile slot (one pull per interval, however many pages read it) and
 * pull. True when the mirror changed, so the caller reads the plan again.
 * A provider failure is logged and the stale mirror stays in force.
 */
export async function reconcileIfStale(userId: string, standing: PlanStanding, now = new Date()): Promise<boolean> {
  const subscription = standing.subscription;
  if (!subscription || !looksStale(subscription, now)) return false;

  const claimed = await claimSubscriptionReconcile(subscription.providerSubscriptionId, now, SUBSCRIPTION_RECONCILE_MIN_INTERVAL_MS);
  if (!claimed) return false;

  try {
    const result = await reconcileUserSubscriptions(userId, now);
    return result.outcomes.created + result.outcomes.applied > 0;
  } catch (error) {
    console.error(`${LOG} lazy reconcile user=${userId} subscription=${subscription.providerSubscriptionId} failed:`, error);
    return false;
  }
}
