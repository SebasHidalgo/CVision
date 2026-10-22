import type { NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { billingStatus } from "@/lib/database/usage";
import { routeOk, toRouteError } from "@/lib/error/toRouteResponse";
import { billingStatusSnapshotSchema, transactionIdSchema, type BillingStatusSnapshot } from "@/lib/schemas/billingSchema";

// One rate-limit statement and one wave of reads; nothing here calls the provider.
export const maxDuration = 30;

/**
 * What the account page polls after a checkout, while the provider's
 * webhook lands the change: the plan in force, the credits, and, for the
 * transaction named in `?transactionId=`, whether it has been applied. A
 * lean read on purpose (no sweep, no reconcile, no provider call): it is
 * polled every few seconds, and a lost webhook is the "Check again"
 * action's business, not the poll's.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    // Polled with backoff by design: this ceiling only stops a runaway loop.
    await assertRateLimit(userId, "status");

    const named = request.nextUrl.searchParams.get("transactionId");
    const transactionId = named && transactionIdSchema.safeParse(named).success ? named : null;

    const status = await billingStatus(userId, transactionId);
    const body: BillingStatusSnapshot = billingStatusSnapshotSchema.parse({
      plan: status.plan,
      subscriptionStatus: status.subscription?.status ?? null,
      cancelAtPeriodEnd: status.subscription?.cancelAtPeriodEnd ?? false,
      periodEnd: status.periodEnd.toISOString(),
      credits: status.credits,
      transactionApplied: status.transactionApplied,
    });
    return routeOk(body);
  } catch (error) {
    return toRouteError(error, "Failed to read billing status");
  }
}
