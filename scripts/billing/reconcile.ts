/**
 * Repairs what a lost webhook left behind, from the provider's own records
 * (the sandbox retries a failed delivery only twice, within two minutes):
 * the mirror of the subscriptions, and the credits of any completed pack
 * transaction that was never granted.
 *
 *   npm run billing:reconcile                 every user with a customer at the provider
 *   npm run billing:reconcile -- <clerkUserId>   one user
 *
 * Goes through the same mirror write and the same grant as the webhook
 * (ordered by the provider's time; keyed by the transaction id), so it
 * never rolls a row back and never grants twice. Prints, per user, what the
 * provider lists and what changed, then the plan that results. Reads the
 * provider through lib/billing; never prints a secret.
 */
import { reconcileUserBilling } from "@/lib/billing/reconcile";
import { listBillingCustomerUserIds, resolvePlanStanding } from "@/lib/database/billing";

async function main() {
  const [onlyUser] = process.argv.slice(2);
  const userIds = onlyUser ? [onlyUser] : await listBillingCustomerUserIds();
  if (userIds.length === 0) {
    console.log("No user has a customer at the provider yet; nothing to reconcile.");
    return;
  }

  for (const userId of userIds) {
    const result = await reconcileUserBilling(userId);
    if (!result.customer) {
      console.log(`${userId}: no customer at the provider`);
      continue;
    }
    const standing = await resolvePlanStanding(userId);
    const subscription = standing.subscription;
    console.log(
      `${userId}: ${result.subscriptions} subscription(s) at the provider; created ${result.outcomes.created}, applied ${result.outcomes.applied}, unchanged ${result.outcomes.stale}` +
        `; ${result.transactions} completed transaction(s), ${result.granted} pack grant(s) repaired` +
        ` -> plan ${standing.plan} (${standing.source})` +
        (subscription
          ? `, ${subscription.providerSubscriptionId} ${subscription.status}${subscription.currentPeriodEnd ? ` until ${subscription.currentPeriodEnd.toISOString()}` : ""}${subscription.cancelAtPeriodEnd ? " (cancels at period end)" : ""}`
          : ""),
    );
  }
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main()
    .catch((error: unknown) => {
      console.error(`billing:reconcile failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { default: prisma } = await import("@/lib/prisma");
      await prisma.$disconnect();
    });
}
