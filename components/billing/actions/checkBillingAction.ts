"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { ACCOUNT_BILLING_PATH } from "@/lib/billing/activation";
import { reconcileUserBilling } from "@/lib/billing/reconcile";
import { transactionApplied } from "@/lib/database/billing";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { checkBillingInputSchema } from "@/lib/schemas/billingSchema";
import type { ActionResult } from "@/types/action";

/**
 * "Check again", for a checkout whose confirmation has not arrived within
 * the account page's ceiling: asks the provider for the caller's
 * subscriptions and completed transactions, repairs whatever the webhook
 * did not deliver, and answers whether the transaction the page waits for
 * is applied now. Rate-limited: each press is two provider reads.
 */
export async function checkBillingAction(input: unknown): Promise<ActionResult<{ applied: boolean }>> {
  try {
    const userId = await requireUserId();
    await assertRateLimit(userId, "reconcile");

    const parsed = checkBillingInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid transaction id");

    await reconcileUserBilling(userId);
    const applied = await transactionApplied(userId, parsed.data.transactionId);

    revalidatePath(ACCOUNT_BILLING_PATH);
    return { ok: true, data: { applied } };
  } catch (error) {
    return toActionError(error, "Failed to check the billing status with the provider");
  }
}
