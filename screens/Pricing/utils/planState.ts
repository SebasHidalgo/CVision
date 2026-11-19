import type { SubscriptionStatusId } from "@/lib/billing/access";
import type { UsageSummary } from "@/lib/database/usage";
import type { PlanId } from "@/lib/plans";

/** What the pricing page knows about its reader: nothing signed out; the usage summary's facts signed in. */
export type PricingFacts =
  | { signedIn: false }
  | {
      signedIn: true;
      plan: PlanId;
      /** Where the plan comes from (lib/billing/access.ts). */
      source: "subscription" | "comp" | "free";
      /** The subscription the standing rests on, or the latest one. */
      subscription: { status: SubscriptionStatusId; cancelAtPeriodEnd: boolean; scheduledChangeAt: Date | null } | null;
      /** A subscription still open (not canceled), granting or not: a Pro checkout would refuse while there is one. */
      openSubscription: SubscriptionStatusId | null;
      everSubscribed: boolean;
      trial: { available: boolean; used: boolean };
      /** Pack credits held. */
      credits: number;
      /** A customer at the provider: the portal exists for them. */
      hasBillingAccount: boolean;
      /** The current period's end: a subscribed Pro's renewal. */
      resetsAt: Date;
    };

export type PricingStateKind =
  | "signed-out"
  | "free"
  | "free-after-pro"
  | "pro"
  | "pro-comp"
  | "past-due"
  | "canceling"
  | "paused"
  | "pending";

/** A plan's action, decided here and drawn by the screen. */
export type PlanActionSpec =
  | { kind: "sign-up"; redirect: "/resume/upload" | "/pricing" }
  | { kind: "checkout-pro" }
  | { kind: "portal"; label: "manage" | "fixPayment" | "payments" }
  | { kind: "link"; to: "upload" | "account" }
  /** "Included in Pro": a line, no action. */
  | { kind: "included" }
  | { kind: "none" };

export type StandingDetail =
  | { key: "trialAvailable" | "trialUsed" | "noTrial" | "afterPro" | "comp" | "pastDue" | "paused" | "pending" }
  | { key: "renews" | "canceling"; date: Date };

export type StandingSpec = {
  /** Filled: the reader's plan; half: theirs but at risk or ending (past due, cancellation scheduled); outline: a note. */
  tone: "current" | "at-risk" | "note";
  label: "yourPlan" | "paused" | "pending" | "from";
  /** For "from": the day Free takes over. */
  date?: Date;
  detail: StandingDetail | null;
};

export type PlanCardSpec = { standing: StandingSpec | null; action: PlanActionSpec };

export type PricingState = {
  kind: PricingStateKind;
  free: PlanCardSpec;
  pro: PlanCardSpec;
  /** The pack: bought only with Pro in force (comp included); the credits held are shown on any plan. */
  pack: { checkout: boolean; held: number };
};

/** The facts the page reads: the usage summary and the open subscription's status (the checkout's own test). */
export function factsFromSummary(summary: UsageSummary, openSubscription: SubscriptionStatusId | null): PricingFacts {
  return {
    signedIn: true,
    plan: summary.plan,
    source: summary.source,
    subscription: summary.subscription,
    openSubscription,
    everSubscribed: summary.everSubscribed,
    trial: summary.trial,
    credits: summary.credits.balance,
    hasBillingAccount: summary.hasBillingAccount,
    resetsAt: summary.resetsAt,
  };
}

const SIGNED_OUT: PricingState = {
  kind: "signed-out",
  free: { standing: null, action: { kind: "sign-up", redirect: "/resume/upload" } },
  pro: { standing: null, action: { kind: "sign-up", redirect: "/pricing" } },
  pack: { checkout: false, held: 0 },
};

/**
 * Pure: the reader's plan facts → what each plan shows and which action it offers. It follows the checkout's own
 * rules (components/billing/actions/createCheckoutAction.ts): Pro is never offered while a subscription is open (the
 * portal is), and the pack only with Pro in force. A past-due Pro is still Pro; a paused subscription is not.
 */
export function pricingState(facts: PricingFacts): PricingState {
  if (!facts.signedIn) return SIGNED_OUT;
  const { plan, source, subscription, openSubscription, everSubscribed, trial, credits, hasBillingAccount, resetsAt } = facts;
  // A subscription always has a customer; if the row is missing, the account page explains the plan instead.
  const portal = (label: "manage" | "fixPayment"): PlanActionSpec => (hasBillingAccount ? { kind: "portal", label } : { kind: "link", to: "account" });

  if (plan === "PRO") {
    const pro = (detail: StandingDetail, action: PlanActionSpec, tone: "current" | "at-risk" = "current"): PlanCardSpec => ({ standing: { tone, label: "yourPlan", detail }, action });
    const included: PlanCardSpec = { standing: null, action: { kind: "included" } };
    const pack = { checkout: true, held: credits };

    if (source === "comp") {
      // A comp has no subscription to manage; a customer exists only after a pack, and then the portal lists its payments.
      const action: PlanActionSpec = hasBillingAccount ? { kind: "portal", label: "payments" } : { kind: "link", to: "account" };
      return { kind: "pro-comp", free: included, pro: pro({ key: "comp" }, action), pack };
    }
    if (subscription?.status === "PAST_DUE") {
      return { kind: "past-due", free: included, pro: pro({ key: "pastDue" }, portal("fixPayment"), "at-risk"), pack };
    }
    if (subscription?.cancelAtPeriodEnd && subscription.scheduledChangeAt) {
      const date = subscription.scheduledChangeAt;
      return {
        kind: "canceling",
        free: { standing: { tone: "note", label: "from", date, detail: null }, action: { kind: "none" } },
        pro: pro({ key: "canceling", date }, portal("manage"), "at-risk"),
        pack,
      };
    }
    return { kind: "pro", free: included, pro: pro({ key: "renews", date: resetsAt }, portal("manage")), pack };
  }

  const free = (detail: StandingDetail | null): PlanCardSpec => ({ standing: { tone: "current", label: "yourPlan", detail }, action: { kind: "link", to: "upload" } });
  const pack = { checkout: false, held: credits };

  // An open subscription that grants nothing: a new one can't start, so the portal, never a checkout that refuses.
  if (openSubscription === "PAUSED") {
    return { kind: "paused", free: free(null), pro: { standing: { tone: "note", label: "paused", detail: { key: "paused" } }, action: portal("manage") }, pack };
  }
  if (openSubscription) {
    return { kind: "pending", free: free(null), pro: { standing: { tone: "note", label: "pending", detail: { key: "pending" } }, action: portal("manage") }, pack };
  }

  // The trial is only for accounts that never had voice (never subscribed, never a full interview).
  const detail: StandingDetail = trial.available
    ? { key: "trialAvailable" }
    : everSubscribed
      ? { key: "afterPro" }
      : trial.used
        ? { key: "trialUsed" }
        : { key: "noTrial" };
  return { kind: everSubscribed ? "free-after-pro" : "free", free: free(detail), pro: { standing: null, action: { kind: "checkout-pro" } }, pack };
}
