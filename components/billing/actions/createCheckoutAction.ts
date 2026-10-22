"use server";

import { createCheckout } from "@/lib/billing";
import type { CheckoutSession } from "@/lib/billing/types";
import { listSubscriptionRows, resolvePlanStanding } from "@/lib/database/billing";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { ensureUser } from "@/lib/database/user";
import { AlreadySubscribedError, PackRequiresProError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { checkoutInputSchema } from "@/lib/schemas/billingSchema";
import type { ActionResult } from "@/types/action";

/**
 * A checkout for the caller: the server decides who pays and for what, the
 * browser only opens what comes back. Eligibility first, then the provider:
 * Pro is refused while any subscription is open (active, trialing, past
 * due or paused: the portal is where those are managed; a canceled one may
 * be replaced), and the pack is refused without an active Pro. Rate-limited,
 * since every call creates a record at the provider.
 */
export async function createCheckoutAction(input: unknown): Promise<ActionResult<CheckoutSession>> {
  try {
    const userId = await ensureUser();
    await assertRateLimit(userId, "checkout");

    const parsed = checkoutInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid checkout input");
    const { item } = parsed.data;

    if (item === "pro_monthly") {
      const rows = await listSubscriptionRows(userId);
      const open = rows.some((row) => row.status !== "CANCELED");
      if (open) throw new AlreadySubscribedError();
    } else {
      const standing = await resolvePlanStanding(userId);
      // Buying needs Pro in force (a comp counts); using the credits does not.
      if (standing.plan !== "PRO") throw new PackRequiresProError();
    }

    const session = await createCheckout(userId, item);
    return { ok: true, data: session };
  } catch (error) {
    return toActionError(error, "Failed to create a checkout");
  }
}
