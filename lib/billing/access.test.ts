import { describe, expect, it } from "vitest";
import {
  ACCESS_BY_STATUS,
  grantsAccess,
  quotaPeriodFor,
  standingFrom,
  type SubscriptionStanding,
  type SubscriptionStatusId,
} from "./access";

const NOW = new Date("2026-10-20T12:00:00Z");

const subscription = (overrides: Partial<SubscriptionStanding> = {}): SubscriptionStanding => ({
  id: "sub_row_1",
  providerSubscriptionId: "sub_1",
  status: "ACTIVE",
  priceKey: "pro_monthly",
  currentPeriodStart: new Date("2026-10-05T00:00:00Z"),
  currentPeriodEnd: new Date("2026-11-05T00:00:00Z"),
  cancelAtPeriodEnd: false,
  scheduledChangeAt: null,
  canceledAt: null,
  providerUpdatedAt: new Date("2026-10-05T00:00:01Z"),
  ...overrides,
});

describe("the status table", () => {
  it.each([
    ["ACTIVE", true],
    ["TRIALING", true],
    ["PAST_DUE", true],
    ["PAUSED", false],
    ["CANCELED", false],
  ] as [SubscriptionStatusId, boolean][])("%s grants Pro: %s", (status, expected) => {
    expect(ACCESS_BY_STATUS[status]).toBe(expected);
    expect(grantsAccess(subscription({ status }), NOW)).toBe(expected);
  });

  it("a scheduled cancellation keeps Pro until it takes effect, and not past it", () => {
    const scheduled = subscription({ cancelAtPeriodEnd: true, scheduledChangeAt: new Date("2026-11-05T00:00:00Z") });
    expect(grantsAccess(scheduled, NOW)).toBe(true);
    expect(grantsAccess(scheduled, new Date("2026-11-04T23:59:59Z"))).toBe(true);
    // At the effective moment the provider's canceled event is the truth; a stale active row does not extend Pro.
    expect(grantsAccess(scheduled, new Date("2026-11-05T00:00:00Z"))).toBe(false);
    expect(grantsAccess(scheduled, new Date("2026-11-20T00:00:00Z"))).toBe(false);
  });
});

describe("standingFrom", () => {
  it("is Pro from the subscription when one grants access, whatever the comp says", () => {
    const standing = standingFrom({ compPlan: null, subscriptions: [subscription()] }, NOW);
    expect(standing).toMatchObject({ plan: "PRO", source: "subscription", everSubscribed: true });
    expect(standing.subscription?.providerSubscriptionId).toBe("sub_1");
  });

  it("is Pro from the comp when no subscription grants access, keeping the latest subscription in view", () => {
    const canceled = subscription({ status: "CANCELED", currentPeriodStart: null, currentPeriodEnd: null, canceledAt: NOW });
    const standing = standingFrom({ compPlan: "PRO", subscriptions: [canceled] }, NOW);
    expect(standing).toMatchObject({ plan: "PRO", source: "comp", everSubscribed: true });
    expect(standing.subscription?.status).toBe("CANCELED");
  });

  it("is Free, with the trial still possible, for an account that never subscribed", () => {
    expect(standingFrom({ compPlan: null, subscriptions: [] }, NOW)).toEqual({
      plan: "FREE",
      source: "free",
      subscription: null,
      everSubscribed: false,
    });
  });

  it("is Free after a cancellation lands, and remembers the account had voice", () => {
    const ended = subscription({ status: "CANCELED", canceledAt: new Date("2026-10-19T00:00:00Z") });
    const standing = standingFrom({ compPlan: null, subscriptions: [ended] }, NOW);
    expect(standing).toMatchObject({ plan: "FREE", source: "free", everSubscribed: true });
    expect(standing.subscription?.providerSubscriptionId).toBe("sub_1");
  });

  it("with two granting subscriptions, the one whose period runs longest decides the period", () => {
    const shorter = subscription({ id: "a", providerSubscriptionId: "sub_a", currentPeriodEnd: new Date("2026-10-25T00:00:00Z") });
    const longer = subscription({ id: "b", providerSubscriptionId: "sub_b", currentPeriodEnd: new Date("2026-11-10T00:00:00Z") });
    expect(standingFrom({ compPlan: null, subscriptions: [shorter, longer] }, NOW).subscription?.providerSubscriptionId).toBe("sub_b");
  });

  it("treats a FREE comp like no comp", () => {
    expect(standingFrom({ compPlan: "FREE", subscriptions: [] }, NOW).plan).toBe("FREE");
  });
});

describe("quotaPeriodFor", () => {
  it("is the billing period for a subscribed Pro and the UTC month for everyone else", () => {
    const subscribed = standingFrom({ compPlan: null, subscriptions: [subscription()] }, NOW);
    expect(quotaPeriodFor(subscribed, NOW)).toEqual({
      start: new Date("2026-10-05T00:00:00Z"),
      end: new Date("2026-11-05T00:00:00Z"),
    });

    const month = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") };
    expect(quotaPeriodFor(standingFrom({ compPlan: "PRO", subscriptions: [] }, NOW), NOW)).toEqual(month);
    expect(quotaPeriodFor(standingFrom({ compPlan: null, subscriptions: [] }, NOW), NOW)).toEqual(month);
    // A canceled subscription grants nothing, so its old period means nothing either.
    expect(quotaPeriodFor(standingFrom({ compPlan: null, subscriptions: [subscription({ status: "CANCELED" })] }, NOW), NOW)).toEqual(month);
  });

  it("rolls over with the renewal: the new period's events count against the new period", () => {
    const renewed = subscription({ currentPeriodStart: new Date("2026-11-05T00:00:00Z"), currentPeriodEnd: new Date("2026-12-05T00:00:00Z") });
    const later = new Date("2026-11-10T00:00:00Z");
    expect(quotaPeriodFor(standingFrom({ compPlan: null, subscriptions: [renewed] }, later), later)).toEqual({
      start: new Date("2026-11-05T00:00:00Z"),
      end: new Date("2026-12-05T00:00:00Z"),
    });
  });

  it("does not open a fresh allowance on a stale mirror: past the period's end the window runs from the old start to now", () => {
    const stale = standingFrom({ compPlan: null, subscriptions: [subscription()] }, NOW);
    const afterEnd = new Date("2026-11-06T12:00:00Z");
    expect(quotaPeriodFor(stale, afterEnd)).toEqual({
      start: new Date("2026-10-05T00:00:00Z"),
      end: new Date(afterEnd.getTime() + 1),
    });
  });
});
