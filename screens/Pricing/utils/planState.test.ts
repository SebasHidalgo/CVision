import { describe, expect, it } from "vitest";
import { pricingState, type PricingFacts } from "./planState";

const RESETS = new Date("2026-12-01T00:00:00.000Z");
const CANCELS = new Date("2026-12-05T00:00:00.000Z");

type SignedIn = Extract<PricingFacts, { signedIn: true }>;

/** A new Free account; each case changes what it needs. */
function facts(overrides: Partial<SignedIn> = {}): SignedIn {
  return {
    signedIn: true,
    plan: "FREE",
    source: "free",
    subscription: null,
    openSubscription: null,
    everSubscribed: false,
    trial: { available: true, used: false },
    credits: 0,
    hasBillingAccount: false,
    resetsAt: RESETS,
    ...overrides,
  };
}

const subscribed = (status: "ACTIVE" | "TRIALING" | "PAST_DUE" | "PAUSED" | "CANCELED", extra: { cancelAtPeriodEnd?: boolean; scheduledChangeAt?: Date | null } = {}) => ({
  status,
  cancelAtPeriodEnd: extra.cancelAtPeriodEnd ?? false,
  scheduledChangeAt: extra.scheduledChangeAt ?? null,
});

describe("pricingState", () => {
  it("a visitor: sign-up on both plans, Free to the upload page and Pro back here for the checkout; no pack to buy", () => {
    const state = pricingState({ signedIn: false });
    expect(state.kind).toBe("signed-out");
    expect(state.free).toEqual({ standing: null, action: { kind: "sign-up", redirect: "/resume/upload" } });
    expect(state.pro).toEqual({ standing: null, action: { kind: "sign-up", redirect: "/pricing" } });
    expect(state.pack).toEqual({ checkout: false, held: 0 });
  });

  it("a new Free account: its plan, the trial waiting, the Pro checkout; the pack needs Pro", () => {
    const state = pricingState(facts());
    expect(state.kind).toBe("free");
    expect(state.free.standing).toEqual({ tone: "current", label: "yourPlan", detail: { key: "trialAvailable" } });
    expect(state.free.action).toEqual({ kind: "link", to: "upload" });
    expect(state.pro).toEqual({ standing: null, action: { kind: "checkout-pro" } });
    expect(state.pack.checkout).toBe(false);
  });

  it("a Free account whose trial is used is told so, and still offered Pro", () => {
    const state = pricingState(facts({ trial: { available: false, used: true } }));
    expect(state.free.standing?.detail).toEqual({ key: "trialUsed" });
    expect(state.pro.action).toEqual({ kind: "checkout-pro" });
  });

  it("a Free account that had voice without a subscription (a comp that ended) is told the trial is not for it", () => {
    expect(pricingState(facts({ trial: { available: false, used: false } })).free.standing?.detail).toEqual({ key: "noTrial" });
  });

  it("a Free account whose email used its trial on another account is told so; a check that could not run gets no line", () => {
    expect(pricingState(facts({ trial: { available: false, used: false, blocked: "claimed" } })).free.standing?.detail).toEqual({ key: "trialClaimed" });
    expect(pricingState(facts({ trial: { available: false, used: false, blocked: "unavailable" } })).free.standing?.detail).toBeNull();
  });

  it("Free after a canceled Pro: nothing deleted, Pro again by checkout (a canceled subscription may be replaced), credits shown", () => {
    const state = pricingState(facts({ everSubscribed: true, trial: { available: false, used: false }, subscription: subscribed("CANCELED"), credits: 3, hasBillingAccount: true }));
    expect(state.kind).toBe("free-after-pro");
    expect(state.free.standing?.detail).toEqual({ key: "afterPro" });
    expect(state.pro.action).toEqual({ kind: "checkout-pro" });
    expect(state.pack).toEqual({ checkout: false, held: 3 });
  });

  it("Pro by subscription: its plan with the renewal date, the portal, Free included, the pack for sale", () => {
    const state = pricingState(facts({ plan: "PRO", source: "subscription", subscription: subscribed("ACTIVE"), openSubscription: "ACTIVE", everSubscribed: true, hasBillingAccount: true, trial: { available: false, used: false } }));
    expect(state.kind).toBe("pro");
    expect(state.pro.standing).toEqual({ tone: "current", label: "yourPlan", detail: { key: "renews", date: RESETS } });
    expect(state.pro.action).toEqual({ kind: "portal", label: "manage" });
    expect(state.free).toEqual({ standing: null, action: { kind: "included" } });
    expect(state.pack.checkout).toBe(true);
  });

  it("a trialing subscription reads as Pro", () => {
    expect(pricingState(facts({ plan: "PRO", source: "subscription", subscription: subscribed("TRIALING"), hasBillingAccount: true })).kind).toBe("pro");
  });

  it("a subscribed Pro with no customer row gets the account page instead of a portal that would refuse", () => {
    expect(pricingState(facts({ plan: "PRO", source: "subscription", subscription: subscribed("ACTIVE") })).pro.action).toEqual({ kind: "link", to: "account" });
  });

  it("Pro by comp: no portal without a billing customer; with one (a pack bought), the portal for its payments; the pack for sale", () => {
    const comp = pricingState(facts({ plan: "PRO", source: "comp" }));
    expect(comp.kind).toBe("pro-comp");
    expect(comp.pro.standing?.detail).toEqual({ key: "comp" });
    expect(comp.pro.action).toEqual({ kind: "link", to: "account" });
    expect(comp.pack.checkout).toBe(true);
    expect(pricingState(facts({ plan: "PRO", source: "comp", hasBillingAccount: true })).pro.action).toEqual({ kind: "portal", label: "payments" });
  });

  it("past due is still Pro: the portal to fix the payment, the pack still for sale", () => {
    const state = pricingState(facts({ plan: "PRO", source: "subscription", subscription: subscribed("PAST_DUE"), openSubscription: "PAST_DUE", hasBillingAccount: true }));
    expect(state.kind).toBe("past-due");
    expect(state.pro.standing).toEqual({ tone: "at-risk", label: "yourPlan", detail: { key: "pastDue" } });
    expect(state.pro.action).toEqual({ kind: "portal", label: "fixPayment" });
    expect(state.pack.checkout).toBe(true);
  });

  it("canceled at period end: Pro until the date, Free from it, the portal; credits outlive Pro, so the pack is still sold", () => {
    const state = pricingState(
      facts({ plan: "PRO", source: "subscription", subscription: subscribed("ACTIVE", { cancelAtPeriodEnd: true, scheduledChangeAt: CANCELS }), openSubscription: "ACTIVE", hasBillingAccount: true, credits: 2 }),
    );
    expect(state.kind).toBe("canceling");
    expect(state.pro.standing).toEqual({ tone: "at-risk", label: "yourPlan", detail: { key: "canceling", date: CANCELS } });
    expect(state.pro.action).toEqual({ kind: "portal", label: "manage" });
    expect(state.free).toEqual({ standing: { tone: "note", label: "from", date: CANCELS, detail: null }, action: { kind: "none" } });
    expect(state.pack).toEqual({ checkout: true, held: 2 });
  });

  it("paused is not Pro: Free is the plan, the portal to resume, never a Pro checkout (it would refuse) nor a pack", () => {
    const state = pricingState(facts({ subscription: subscribed("PAUSED"), openSubscription: "PAUSED", everSubscribed: true, hasBillingAccount: true, trial: { available: false, used: false } }));
    expect(state.kind).toBe("paused");
    expect(state.free.standing).toEqual({ tone: "current", label: "yourPlan", detail: null });
    expect(state.pro).toEqual({ standing: { tone: "note", label: "paused", detail: { key: "paused" } }, action: { kind: "portal", label: "manage" } });
    expect(state.pack.checkout).toBe(false);
  });

  it("an open subscription that grants nothing yet (a cancellation the mirror hasn't seen land): the portal, no checkout", () => {
    const state = pricingState(
      facts({ subscription: subscribed("ACTIVE", { cancelAtPeriodEnd: true, scheduledChangeAt: new Date("2026-11-01T00:00:00.000Z") }), openSubscription: "ACTIVE", everSubscribed: true, hasBillingAccount: true, trial: { available: false, used: false } }),
    );
    expect(state.kind).toBe("pending");
    expect(state.pro.action).toEqual({ kind: "portal", label: "manage" });
    expect(state.pro.standing?.label).toBe("pending");
  });

  it("never offers a Pro checkout while a subscription is open, nor a pack without Pro", () => {
    const statuses = ["ACTIVE", "TRIALING", "PAST_DUE", "PAUSED"] as const;
    for (const open of statuses) {
      for (const plan of ["FREE", "PRO"] as const) {
        const state = pricingState(facts({ plan, source: plan === "PRO" ? "subscription" : "free", subscription: subscribed(open), openSubscription: open, everSubscribed: true, hasBillingAccount: true }));
        expect([state.free.action.kind, state.pro.action.kind]).not.toContain("checkout-pro");
        expect(state.pack.checkout).toBe(plan === "PRO");
      }
    }
  });
});
