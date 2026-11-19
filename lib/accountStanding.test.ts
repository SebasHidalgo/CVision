import { describe, expect, it } from "vitest";
import type { SubscriptionStanding } from "@/lib/billing/access";
import { accountStanding, creditsView, offersProCheckout, STANDING_SHAPE } from "./accountStanding";

const RESETS = new Date("2026-12-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-12-14T00:00:00.000Z");

function subscription(overrides: Partial<SubscriptionStanding> = {}): SubscriptionStanding {
  return {
    id: "row_1",
    providerSubscriptionId: "sub_1",
    status: "ACTIVE",
    priceKey: "pro_monthly",
    currentPeriodStart: new Date("2026-11-14T00:00:00.000Z"),
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    scheduledChangeAt: null,
    canceledAt: null,
    providerUpdatedAt: new Date("2026-11-14T00:00:00.000Z"),
    ...overrides,
  };
}

describe("accountStanding", () => {
  it("reads every state of the plan table", () => {
    expect(accountStanding({ plan: "FREE", source: "free", subscription: null, resetsAt: RESETS })).toEqual({ kind: "free" });
    expect(accountStanding({ plan: "PRO", source: "comp", subscription: null, resetsAt: RESETS })).toEqual({ kind: "comp" });
    expect(accountStanding({ plan: "PRO", source: "subscription", subscription: subscription(), resetsAt: RESETS })).toEqual({ kind: "active", renewsAt: PERIOD_END });
    expect(accountStanding({ plan: "PRO", source: "subscription", subscription: subscription({ status: "TRIALING" }), resetsAt: RESETS })).toEqual({ kind: "active", renewsAt: PERIOD_END });
    expect(accountStanding({ plan: "PRO", source: "subscription", subscription: subscription({ status: "PAST_DUE" }), resetsAt: RESETS })).toEqual({
      kind: "past-due",
      periodEnd: PERIOD_END,
    });
    expect(
      accountStanding({ plan: "PRO", source: "subscription", subscription: subscription({ cancelAtPeriodEnd: true, scheduledChangeAt: PERIOD_END }), resetsAt: RESETS }),
    ).toEqual({ kind: "cancels", endsAt: PERIOD_END });
    expect(accountStanding({ plan: "FREE", source: "free", subscription: subscription({ status: "PAUSED", currentPeriodEnd: null }), resetsAt: RESETS })).toEqual({
      kind: "paused",
    });
    expect(accountStanding({ plan: "FREE", source: "free", subscription: subscription({ status: "CANCELED" }), resetsAt: RESETS })).toEqual({ kind: "canceled" });
  });

  it("a comp wins over a subscription that grants nothing, and a scheduled end already past reads as ended", () => {
    expect(accountStanding({ plan: "PRO", source: "comp", subscription: subscription({ status: "CANCELED" }), resetsAt: RESETS })).toEqual({ kind: "comp" });
    // Free with an ACTIVE row whose cancellation has taken effect (the canceled event is late): over, not paused.
    expect(
      accountStanding({ plan: "FREE", source: "free", subscription: subscription({ cancelAtPeriodEnd: true, scheduledChangeAt: RESETS }), resetsAt: RESETS }),
    ).toEqual({ kind: "canceled" });
  });

  it("falls back to the quota period's end when the mirror has no period", () => {
    expect(accountStanding({ plan: "PRO", source: "subscription", subscription: subscription({ currentPeriodEnd: null }), resetsAt: RESETS })).toEqual({
      kind: "active",
      renewsAt: RESETS,
    });
  });

  it("offers a Pro checkout only where it can succeed, and marks the states by shape", () => {
    expect(offersProCheckout({ kind: "free" }, null)).toBe(true);
    expect(offersProCheckout({ kind: "canceled" }, null)).toBe(true);
    // A stale row still open (its end passed, the cancel event not in yet): the checkout would refuse.
    expect(offersProCheckout({ kind: "canceled" }, "ACTIVE")).toBe(false);
    expect(offersProCheckout({ kind: "free" }, "PAST_DUE")).toBe(false);
    for (const kind of ["paused", "comp"] as const) expect(offersProCheckout({ kind }, null)).toBe(false);
    expect(offersProCheckout({ kind: "active", renewsAt: RESETS }, null)).toBe(false);
    expect(offersProCheckout({ kind: "past-due", periodEnd: RESETS }, null)).toBe(false);
    expect(offersProCheckout({ kind: "cancels", endsAt: RESETS }, null)).toBe(false);
    expect(STANDING_SHAPE).toEqual({ active: "filled", comp: "filled", "past-due": "half", cancels: "half", paused: "empty", canceled: "empty", free: "empty" });
  });
});

describe("creditsView", () => {
  it("shows Pro its credits even at zero, and Free only what it holds", () => {
    expect(creditsView({ plan: "PRO", credits: { balance: 0, pending: 0 } })).toEqual({ balance: 0, pending: 0, note: "none" });
    expect(creditsView({ plan: "PRO", credits: { balance: 3, pending: 0 } })).toEqual({ balance: 3, pending: 0, note: "pro" });
    expect(creditsView({ plan: "FREE", credits: { balance: 0, pending: 0 } })).toBeNull();
    expect(creditsView({ plan: "FREE", credits: { balance: 2, pending: 0 } })).toEqual({ balance: 2, pending: 0, note: "free" });
    expect(creditsView({ plan: "FREE", credits: { balance: 0, pending: 1 } })).toEqual({ balance: 0, pending: 1, note: "none" });
  });
});
