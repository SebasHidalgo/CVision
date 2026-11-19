import type { PlanStanding } from "@/lib/billing/access";
import type { PlanId } from "@/lib/plans";

/**
 * The plan as the account pages state it, one of seven: what the derived
 * standing (lib/billing/access.ts) means to the person, with the one date
 * each state needs. Pure; both account pages and their tests read it.
 *
 *   free       Free, never subscribed
 *   canceled   Free after a subscription ended (or its scheduled end passed)
 *   paused     Free while the subscription is paused
 *   comp       Pro by a manual comp
 *   active     Pro by a subscription that renews
 *   past-due   Pro while the provider retries a failed payment
 *   cancels    Pro until a scheduled cancellation takes effect
 */
export type AccountStanding =
  | { kind: "free" }
  | { kind: "canceled" }
  | { kind: "paused" }
  | { kind: "comp" }
  | { kind: "active"; renewsAt: Date }
  // No date: the provider's retry window is days, and the mirror's period is the unpaid one being retried.
  | { kind: "past-due" }
  | { kind: "cancels"; endsAt: Date };

export type StandingKind = AccountStanding["kind"];

/** The mark beside the plan, by shape: Pro in force, Pro ending or at risk, no Pro. */
export type StandingShape = "filled" | "half" | "empty";

export const STANDING_SHAPE: Record<StandingKind, StandingShape> = {
  active: "filled",
  comp: "filled",
  "past-due": "half",
  cancels: "half",
  paused: "empty",
  canceled: "empty",
  free: "empty",
};

type StandingInput = {
  plan: PlanId;
  source: PlanStanding["source"];
  subscription: PlanStanding["subscription"];
  /** The quota period's end: the fallback date when the mirror has no period. */
  resetsAt: Date;
};

export function accountStanding({ plan, source, subscription, resetsAt }: StandingInput): AccountStanding {
  if (plan === "PRO") {
    if (source === "comp" || !subscription) return { kind: "comp" };
    if (subscription.cancelAtPeriodEnd && subscription.scheduledChangeAt) return { kind: "cancels", endsAt: subscription.scheduledChangeAt };
    if (subscription.status === "PAST_DUE") return { kind: "past-due" };
    return { kind: "active", renewsAt: subscription.currentPeriodEnd ?? resetsAt };
  }
  if (!subscription) return { kind: "free" };
  // A Free account's subscription grants nothing: paused, or over (canceled, or its scheduled end has passed).
  return subscription.status === "PAUSED" ? { kind: "paused" } : { kind: "canceled" };
}

/**
 * A Pro checkout the server would accept: never while any subscription is still open (it refuses with
 * ALREADY_SUBSCRIBED, the same `currentOpenSubscriptionStatus` /pricing reads), and pointless while Pro is in force.
 */
export function offersProCheckout(standing: AccountStanding, openSubscription: string | null): boolean {
  return openSubscription === null && (standing.kind === "free" || standing.kind === "canceled");
}

/** Pack credits as the account pages show them, or null where they mean nothing. */
export type CreditsView = {
  balance: number;
  /** Credits held by interviews still open; back if those end without an answer. */
  pending: number;
  /** none: Pro without credits (packs explained); pro: used after the period's; free: full interviews on Free. */
  note: "none" | "pro" | "free";
};

/** Packs are sold to Pro only, so a Free account sees credits only when it holds some (bought while on Pro). */
export function creditsView({ plan, credits }: { plan: PlanId; credits: { balance: number; pending: number } }): CreditsView | null {
  const pro = plan === "PRO";
  if (!pro && credits.balance === 0 && credits.pending === 0) return null;
  return { ...credits, note: credits.balance === 0 ? "none" : pro ? "pro" : "free" };
}
