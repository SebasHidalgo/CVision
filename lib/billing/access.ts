import type { PlanId } from "@/lib/plans";

/**
 * Which plan a user has, derived. `User.plan` is not stored any more: the
 * plan in force is the first of (a subscription whose status grants access,
 * a manual comp, Free). Pure, so the ledger can run it inside its
 * transaction and a test can walk the status table.
 *
 * The status table, as decided for M6 (also in CLAUDE.md):
 *
 *   active      Pro
 *   trialing    Pro (no Pro trial is sold today; kept for the provider's sake)
 *   past_due    Pro, during the provider's payment-retry window: a declined
 *               card is retried for days and the user is not punished for it;
 *               the provider ends the window itself, with canceled or paused
 *   paused      Free
 *   canceled    Free
 *
 * A scheduled cancellation keeps the status active until it takes effect,
 * so Pro stays until the period ends. Past that moment the provider's
 * `canceled` event is the truth; until it arrives, or the reconcile reads
 * it, access is not extended on a stale row.
 */

/** The stored statuses, the Prisma enum's values. */
export type SubscriptionStatusId = "ACTIVE" | "TRIALING" | "PAST_DUE" | "PAUSED" | "CANCELED";

export const ACCESS_BY_STATUS: Record<SubscriptionStatusId, boolean> = {
  ACTIVE: true,
  TRIALING: true,
  PAST_DUE: true,
  PAUSED: false,
  CANCELED: false,
};

export type SubscriptionStanding = {
  id: string;
  providerSubscriptionId: string;
  status: SubscriptionStatusId;
  priceKey: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  scheduledChangeAt: Date | null;
  canceledAt: Date | null;
  providerUpdatedAt: Date;
};

export function grantsAccess(subscription: SubscriptionStanding, now: Date): boolean {
  if (!ACCESS_BY_STATUS[subscription.status]) return false;
  if (
    subscription.cancelAtPeriodEnd &&
    subscription.scheduledChangeAt !== null &&
    subscription.scheduledChangeAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  return true;
}

export type PlanStanding = {
  plan: PlanId;
  /** Where the plan comes from. */
  source: "subscription" | "comp" | "free";
  /** The subscription that grants access or, when none does, the most recently updated one (for the account page). */
  subscription: SubscriptionStanding | null;
  /** The account has or had a subscription: the lifetime trial is not for it. */
  everSubscribed: boolean;
};

export function standingFrom(
  input: { compPlan: PlanId | null; subscriptions: SubscriptionStanding[] },
  now: Date,
): PlanStanding {
  const granting = input.subscriptions
    .filter((subscription) => grantsAccess(subscription, now))
    .sort(byPeriodEndDesc);
  if (granting.length > 0) {
    return { plan: "PRO", source: "subscription", subscription: granting[0], everSubscribed: true };
  }

  const latest = [...input.subscriptions].sort(
    (a, b) => b.providerUpdatedAt.getTime() - a.providerUpdatedAt.getTime(),
  )[0] ?? null;
  const everSubscribed = input.subscriptions.length > 0;

  if (input.compPlan === "PRO") {
    return { plan: "PRO", source: "comp", subscription: latest, everSubscribed };
  }
  return { plan: "FREE", source: "free", subscription: latest, everSubscribed };
}

function byPeriodEndDesc(a: SubscriptionStanding, b: SubscriptionStanding): number {
  return (b.currentPeriodEnd?.getTime() ?? 0) - (a.currentPeriodEnd?.getTime() ?? 0);
}
