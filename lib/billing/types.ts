/**
 * What the app knows about billing, in the app's own words. Nothing here
 * names a provider: `lib/billing/paddle/` translates to and from these
 * shapes, and everything else (the actions, the webhook route, the data
 * layer, the pages) speaks only this. Import-free, so client components can
 * use the keys.
 */

/** What can be bought. Also the catalog's price keys. */
export const CHECKOUT_ITEMS = ["pro_monthly", "interview_pack"] as const;
export type CheckoutItem = (typeof CHECKOUT_ITEMS)[number];
export type PriceKey = CheckoutItem;

/** The provider's subscription states, as every provider worth the name has them. */
export const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "paused", "canceled"] as const;
export type ProviderSubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** One subscription as the provider describes it, reduced to what the app stores. */
export type ProviderSubscription = {
  providerSubscriptionId: string;
  providerCustomerId: string;
  status: ProviderSubscriptionStatus;
  /** Our key for the subscribed price, or null when it is not in the catalog. */
  priceKey: PriceKey | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  /** A cancellation scheduled for the end of the period, and when it lands. */
  cancelAtPeriodEnd: boolean;
  scheduledChangeAt: Date | null;
  canceledAt: Date | null;
  /** The provider's last-modified time: events apply only when newer. */
  providerUpdatedAt: Date;
  /** The user id the server attached at checkout, when the provider echoes it back. */
  userIdHint: string | null;
  /** The transaction that created the subscription, when the provider names it (its created event does). */
  transactionId: string | null;
};

/** One completed transaction as the provider lists it, reduced to what a grant needs. */
export type ProviderTransaction = {
  transactionId: string;
  providerSubscriptionId: string | null;
  items: { priceKey: PriceKey | null; quantity: number }[];
};

export type AdjustmentAction = "refund" | "chargeback" | "credit" | "other";
export type AdjustmentStatus = "pending_approval" | "approved" | "rejected" | "reversed";

/** A verified provider event, translated. The route applies it; the adapter never touches the database. */
export type ParsedBillingEvent = {
  eventId: string;
  /** The provider's event type, for the log and the audit row. */
  type: string;
  occurredAt: Date;
} & (
  | { kind: "subscription"; subscription: ProviderSubscription }
  | {
      kind: "transaction-completed";
      transactionId: string;
      providerCustomerId: string | null;
      providerSubscriptionId: string | null;
      userIdHint: string | null;
      items: { priceKey: PriceKey | null; quantity: number }[];
    }
  | {
      kind: "adjustment";
      adjustmentId: string;
      transactionId: string;
      providerSubscriptionId: string | null;
      providerCustomerId: string;
      action: AdjustmentAction;
      status: AdjustmentStatus;
      /** The whole transaction, or part of it. */
      full: boolean;
    }
  /** Verified, recorded for the audit trail, nothing to apply. */
  | { kind: "ignored" }
);

/** Thrown by the adapter when a delivery fails verification: the route answers 400. Never reaches a user. */
export class WebhookRejectedError extends Error {
  constructor(message = "Webhook signature rejected") {
    super(message);
    this.name = "WebhookRejectedError";
  }
}

/** What the browser needs to open the provider's checkout for a transaction the server created. */
export type CheckoutSession = { transactionId: string };

/** A short-lived link into the provider's self-service portal. */
export type PortalSession = { url: string };

/** What `syncCatalog` found and left on the provider, for the script to print. */
export type CatalogSyncReport = {
  products: { key: PriceKey; productId: string; action: "created" | "updated" | "unchanged"; name: string; description: string | null; taxCategory: string }[];
  prices: {
    key: PriceKey;
    priceId: string;
    action: "created" | "updated" | "unchanged";
    amountMinor: string;
    currency: string;
    interval: string | null;
    quantity: { minimum: number; maximum: number };
  }[];
  webhook: {
    id: string;
    /** "forbidden": the API key may not create or update destinations; `note` says what to do by hand. */
    action: "created" | "updated" | "unchanged" | "skipped" | "forbidden";
    destination: string | null;
    events: string[];
    /** Returned by the provider on create and read; printed once by the script. */
    secret: string | null;
    trafficSource: string | null;
    active: boolean | null;
    note?: string;
  };
};

/** One line of `npm run billing:doctor`: a check of the provider account, read-only, with the exact fix when it fails. */
export type DoctorCheck = {
  name: string;
  outcome: "pass" | "fail" | "skip";
  /** What was found, in one line. Never a secret. */
  detail: string;
  /** What to do, when it failed or could not be checked. */
  fix?: string;
};

/**
 * The contract one provider adapter fulfils. Provider ids in, provider ids
 * out: the user-to-customer mapping lives in the database, behind the
 * facade in `lib/billing/index.ts`.
 */
export type BillingProviderAdapter = {
  /** Read-only checks of the account, the key's permissions and the setup (`billing:doctor`). */
  doctor(options: { webhookUrl: string | null }): Promise<DoctorCheck[]>;
  createTransaction(input: {
    priceKey: PriceKey;
    /** Attached to the transaction so the first event can name the user. */
    userId: string;
    /** The user's existing customer, when known; else the checkout collects the email. */
    providerCustomerId: string | null;
  }): Promise<CheckoutSession>;
  createPortalSession(input: { providerCustomerId: string; providerSubscriptionIds: string[] }): Promise<PortalSession>;
  cancelSubscriptionNow(providerSubscriptionId: string): Promise<ProviderSubscription>;
  listSubscriptions(providerCustomerId: string): Promise<ProviderSubscription[]>;
  /** The customer's completed transactions, for granting a pack whose event never arrived. */
  listCompletedTransactions(providerCustomerId: string): Promise<ProviderTransaction[]>;
  verifyAndParseWebhook(rawBody: string, headers: Headers): Promise<ParsedBillingEvent>;
  syncCatalog(options: { webhookUrl: string | null }): Promise<CatalogSyncReport>;
};
