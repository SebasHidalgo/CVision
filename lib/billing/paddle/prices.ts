import { CHECKOUT_ITEMS, type PriceKey } from "@/lib/billing/types";
import { BillingMisconfiguredError } from "@/lib/error/errors";

/**
 * Paddle's price ids for the catalog keys, from the environment: the sync
 * script creates the prices and prints these to paste. Read per call so a
 * test can set them; no `server-only` because the script imports this too.
 */

export const PRICE_ID_ENV: Record<PriceKey, string> = {
  pro_monthly: "PADDLE_PRICE_PRO_MONTHLY",
  interview_pack: "PADDLE_PRICE_INTERVIEW_PACK",
};

export function priceIdFor(key: PriceKey): string {
  const id = process.env[PRICE_ID_ENV[key]]?.trim();
  if (!id) throw new BillingMisconfiguredError(`${PRICE_ID_ENV[key]} is not set (run npm run billing:sync)`);
  return id;
}

/** The catalog key behind a Paddle price id, or null for a price that is not ours. */
export function priceKeyOf(priceId: string | null | undefined): PriceKey | null {
  if (!priceId) return null;
  for (const key of CHECKOUT_ITEMS) {
    if (process.env[PRICE_ID_ENV[key]]?.trim() === priceId) return key;
  }
  return null;
}
