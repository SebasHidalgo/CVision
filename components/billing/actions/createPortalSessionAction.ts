"use server";

import { requireUserId } from "@/lib/auth";
import { createPortalSession } from "@/lib/billing";
import type { PortalSession } from "@/lib/billing/types";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { toActionError } from "@/lib/error/toActionResult";
import type { ActionResult } from "@/types/action";

/**
 * A short-lived link into the provider's portal for the caller: payment
 * method, invoices, cancellation. Minted when the button is pressed, never
 * at render, because the link expires. NO_BILLING_ACCOUNT for an account
 * that never checked out.
 */
export async function createPortalSessionAction(): Promise<ActionResult<PortalSession>> {
  try {
    const userId = await requireUserId();
    await assertRateLimit(userId, "portal");
    const session = await createPortalSession(userId);
    return { ok: true, data: session };
  } catch (error) {
    return toActionError(error, "Failed to create a billing portal session");
  }
}
