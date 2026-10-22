import type { CheckoutItem } from "./types";

/**
 * How a completed checkout is handed from the button to the account page:
 * the item and the provider's transaction id travel in the URL, the page
 * waits for that transaction to be applied, then cleans the URL. Import-free
 * so the client button and the server page read the same rule.
 */

/** Paddle's transaction ids: `txn_` and 26 lowercase letters or digits. */
export const TRANSACTION_ID_PATTERN = /^txn_[a-z0-9]{26}$/;

export const ACCOUNT_BILLING_PATH = "/account/billing";

export type Activation = { item: CheckoutItem; transactionId: string };

/** Where the button sends the buyer once the overlay reports the payment. */
export function activationHref({ item, transactionId }: Activation): string {
  return `${ACCOUNT_BILLING_PATH}?activating=${item}&txn=${transactionId}`;
}

/** The activation a page's search params name, or null when they name none or a malformed one. */
export function parseActivation(search: { activating?: string | string[]; txn?: string | string[] }): Activation | null {
  const item = search.activating;
  const transactionId = search.txn;
  if ((item !== "pro_monthly" && item !== "interview_pack") || typeof transactionId !== "string") return null;
  if (!TRANSACTION_ID_PATTERN.test(transactionId)) return null;
  return { item, transactionId };
}
