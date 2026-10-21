import { requireUserId } from "@/lib/auth";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { usageSummary } from "@/lib/database/usage";
import { routeOk, toRouteError } from "@/lib/error/toRouteResponse";
import type { BillingStatusSnapshot } from "@/lib/schemas/billingSchema";

// A few counts; the lazy reconcile adds one provider call at most.
export const maxDuration = 30;

/**
 * What the account page polls after a checkout, while the provider's
 * webhook lands the change: the plan in force, the subscription's state,
 * the period's end, the interviews left and the credits. Owner-scoped, JSON
 * only. Reading it is also the sweep and the lazy reconcile, like every
 * read of a quota.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    // Polled with backoff by design: this ceiling only stops a runaway loop.
    await assertRateLimit(userId, "status");

    const summary = await usageSummary(userId);
    const body: BillingStatusSnapshot = {
      plan: summary.plan,
      subscriptionStatus: summary.subscription?.status ?? null,
      cancelAtPeriodEnd: summary.subscription?.cancelAtPeriodEnd ?? false,
      periodEnd: summary.resetsAt.toISOString(),
      interviewsLeft: summary.interviews.left,
      credits: summary.credits.balance,
    };
    return routeOk(body);
  } catch (error) {
    return toRouteError(error, "Failed to read billing status");
  }
}
