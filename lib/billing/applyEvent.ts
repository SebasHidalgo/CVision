import "server-only";

import {
  applySubscriptionSnapshot,
  findUserIdByProviderCustomer,
  findUserIdByProviderSubscription,
  linkBillingCustomer,
  markSubscriptionTransaction,
} from "@/lib/database/billing";
import { grantInterviewCredits, revokeUnusedInterviewCredits } from "@/lib/database/usage";
import { userExists } from "@/lib/database/user";
import { CATALOG } from "./catalog";
import type { ParsedBillingEvent } from "./types";

/**
 * What a verified, claimed provider event does to the database, in the
 * app's words. The webhook route calls this once per claimed event and
 * answers 200 on return; a throw releases the claim and answers 500 so the
 * provider retries.
 *
 * Finding the user: the customer-to-user mapping first (written from the
 * first event that named both), then the signed user id the server put in
 * the transaction's custom data (verified by the adapter; an unsigned one
 * is not a hint), then the mirrored subscription. An event for no user at
 * all (the account was deleted, or the purchase was never ours) is
 * acknowledged and logged, never retried.
 */

const LOG = "[CVision][billing]";

export type ApplyOutcome = {
  userId: string | null;
  /** One line for the log: what was done. Ids and counts only. */
  action: string;
};

export async function applyBillingEvent(event: ParsedBillingEvent, now = new Date()): Promise<ApplyOutcome> {
  switch (event.kind) {
    case "ignored":
      return { userId: null, action: "ignored" };

    case "subscription": {
      const { subscription } = event;
      const userId = await resolveUser({
        providerCustomerId: subscription.providerCustomerId,
        userIdHint: subscription.userIdHint,
        providerSubscriptionId: subscription.providerSubscriptionId,
      });
      if (!userId) return { userId: null, action: `subscription ${subscription.providerSubscriptionId}: no user, acknowledged` };

      await linkBillingCustomer(userId, subscription.providerCustomerId);
      const outcome = await applySubscriptionSnapshot(userId, subscription);
      return { userId, action: `subscription ${subscription.providerSubscriptionId} ${subscription.status}: ${outcome}` };
    }

    case "transaction-completed": {
      const userId = await resolveUser({
        providerCustomerId: event.providerCustomerId,
        userIdHint: event.userIdHint,
        providerSubscriptionId: event.providerSubscriptionId,
      });
      if (!userId) return { userId: null, action: `transaction ${event.transactionId}: no user, acknowledged` };
      if (event.providerCustomerId) await linkBillingCustomer(userId, event.providerCustomerId);
      // A subscription payment: the mirror learns which checkout opened it
      // (the account page waits on that), whichever of the two events came first.
      if (event.providerSubscriptionId) await markSubscriptionTransaction(event.providerSubscriptionId, event.transactionId);

      // The units come from the catalog as it stands when the event is
      // applied, and are stored on the grant: a pack sold at another size
      // keeps the size it was sold at.
      const units = event.items.reduce((sum, item) => sum + item.quantity * (item.priceKey ? (CATALOG[item.priceKey].credits ?? 0) : 0), 0);
      if (units === 0) return { userId, action: `transaction ${event.transactionId} completed: nothing to grant` };

      const { granted } = await grantInterviewCredits(userId, { units, transactionId: event.transactionId, now });
      return {
        userId,
        action: granted
          ? `transaction ${event.transactionId}: ${units} credit(s) granted`
          : `transaction ${event.transactionId}: credits already granted`,
      };
    }

    case "adjustment": {
      const userId = await resolveUser({
        providerCustomerId: event.providerCustomerId,
        userIdHint: null,
        providerSubscriptionId: event.providerSubscriptionId,
      });
      if (!userId) return { userId: null, action: `adjustment ${event.adjustmentId}: no user, acknowledged` };

      const clawsBack = (event.action === "refund" || event.action === "chargeback") && event.status === "approved";
      if (!clawsBack) {
        return { userId, action: `adjustment ${event.adjustmentId} ${event.action} ${event.status}: recorded, nothing applied` };
      }
      if (event.providerSubscriptionId) {
        // Money went back for a subscription period; the interviews of that
        // period happened and are not clawed back. Logged for the owner.
        console.warn(
          `${LOG} user=${userId} ${event.action} of subscription payment transaction=${event.transactionId} (subscription=${event.providerSubscriptionId}): usage not clawed back`,
        );
        return { userId, action: `${event.action} of subscription payment ${event.transactionId}: logged, usage kept` };
      }
      const result = await revokeUnusedInterviewCredits(userId, {
        transactionId: event.transactionId,
        adjustmentId: event.adjustmentId,
        now,
      });
      if (result.outcome === "no-grant") {
        return { userId, action: `${event.action} of transaction ${event.transactionId}: not a pack, nothing revoked` };
      }
      return {
        userId,
        action: `${event.action} of pack ${event.transactionId}: ${result.revoked} unused credit(s) revoked (${result.outcome})`,
      };
    }
  }
}

async function resolveUser(input: {
  providerCustomerId: string | null;
  userIdHint: string | null;
  providerSubscriptionId: string | null;
}): Promise<string | null> {
  const mapped = input.providerCustomerId ? await findUserIdByProviderCustomer(input.providerCustomerId) : null;
  if (mapped) {
    if (input.userIdHint && input.userIdHint !== mapped) {
      console.warn(
        `${LOG} customer=${input.providerCustomerId} is user=${mapped} but the event names user=${input.userIdHint}; the mapping wins`,
      );
    }
    return mapped;
  }
  if (input.userIdHint && (await userExists(input.userIdHint))) return input.userIdHint;
  if (input.providerSubscriptionId) return findUserIdByProviderSubscription(input.providerSubscriptionId);
  return null;
}
