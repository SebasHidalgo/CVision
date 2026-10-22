import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySubscriptionSnapshot, claimSubscriptionReconcile, findBillingCustomer } from "@/lib/database/billing";
import { grantInterviewCredits } from "@/lib/database/credits";
import type { PlanStanding, SubscriptionStanding } from "./access";
import { listProviderSubscriptions, listProviderTransactions } from "./index";
import {
  looksStale,
  RECONCILE_STALE_GRACE_MS,
  reconcileIfStale,
  reconcileUserBilling,
  reconcileUserSubscriptions,
  SUBSCRIPTION_RECONCILE_MIN_INTERVAL_MS,
} from "./reconcile";
import type { ProviderSubscription, ProviderTransaction } from "./types";

vi.mock("@/lib/database/billing", () => ({
  applySubscriptionSnapshot: vi.fn(async () => "applied"),
  claimSubscriptionReconcile: vi.fn(async () => true),
  findBillingCustomer: vi.fn(async () => ({ providerCustomerId: "ctm_01" })),
}));
vi.mock("./index", () => ({ listProviderSubscriptions: vi.fn(async () => []), listProviderTransactions: vi.fn(async () => []) }));
vi.mock("@/lib/database/credits", () => ({ grantInterviewCredits: vi.fn(async () => ({ granted: true })) }));

const NOW = new Date("2026-11-21T12:00:00Z");

const remote = (overrides: Partial<ProviderSubscription> = {}): ProviderSubscription => ({
  providerSubscriptionId: "sub_01",
  providerCustomerId: "ctm_01",
  status: "active",
  priceKey: "pro_monthly",
  currentPeriodStart: new Date("2026-11-20T10:00:00Z"),
  currentPeriodEnd: new Date("2026-12-20T10:00:00Z"),
  cancelAtPeriodEnd: false,
  scheduledChangeAt: null,
  canceledAt: null,
  providerUpdatedAt: new Date("2026-11-20T10:00:05Z"),
  userIdHint: "user_1",
  transactionId: null,
  ...overrides,
});

const mirrored = (overrides: Partial<SubscriptionStanding> = {}): SubscriptionStanding => ({
  id: "row_1",
  providerSubscriptionId: "sub_01",
  status: "ACTIVE",
  priceKey: "pro_monthly",
  currentPeriodStart: new Date("2026-10-20T10:00:00Z"),
  currentPeriodEnd: new Date("2026-11-20T10:00:00Z"),
  cancelAtPeriodEnd: false,
  scheduledChangeAt: null,
  canceledAt: null,
  providerUpdatedAt: new Date("2026-10-20T10:00:05Z"),
  ...overrides,
});

const standing = (subscription: SubscriptionStanding | null): PlanStanding => ({
  plan: subscription ? "PRO" : "FREE",
  source: subscription ? "subscription" : "free",
  subscription,
  everSubscribed: subscription !== null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findBillingCustomer).mockResolvedValue({ providerCustomerId: "ctm_01" });
  vi.mocked(claimSubscriptionReconcile).mockResolvedValue(true);
  vi.mocked(applySubscriptionSnapshot).mockResolvedValue("applied");
  vi.mocked(listProviderSubscriptions).mockResolvedValue([]);
  vi.mocked(listProviderTransactions).mockResolvedValue([]);
  vi.mocked(grantInterviewCredits).mockResolvedValue({ granted: true });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reconcileUserSubscriptions", () => {
  it("pulls the customer's subscriptions and pushes each through the mirror write", async () => {
    vi.mocked(listProviderSubscriptions).mockResolvedValue([remote(), remote({ providerSubscriptionId: "sub_old", status: "canceled" })]);
    vi.mocked(applySubscriptionSnapshot).mockResolvedValueOnce("applied").mockResolvedValueOnce("stale");

    expect(await reconcileUserSubscriptions("user_1", NOW)).toEqual({
      customer: true,
      subscriptions: 2,
      outcomes: { created: 0, applied: 1, stale: 1, "no-user": 0 },
    });
    expect(listProviderSubscriptions).toHaveBeenCalledWith("ctm_01");
    expect(applySubscriptionSnapshot).toHaveBeenCalledWith("user_1", expect.objectContaining({ providerSubscriptionId: "sub_01" }));
  });

  it("does nothing for a user who never checked out", async () => {
    vi.mocked(findBillingCustomer).mockResolvedValue(null);
    expect(await reconcileUserSubscriptions("user_1", NOW)).toEqual({ customer: false, subscriptions: 0, outcomes: { created: 0, applied: 0, stale: 0, "no-user": 0 } });
    expect(listProviderSubscriptions).not.toHaveBeenCalled();
  });
});

describe("reconcileUserBilling", () => {
  const transaction = (overrides: Partial<ProviderTransaction> = {}): ProviderTransaction => ({
    transactionId: "txn_pack",
    providerSubscriptionId: null,
    items: [{ priceKey: "interview_pack", quantity: 1 }],
    ...overrides,
  });

  it("grants a completed pack whose event never arrived, with the catalog's units, keyed by the transaction; a pack already granted and a subscription payment change nothing", async () => {
    vi.mocked(listProviderTransactions).mockResolvedValue([
      transaction(),
      transaction({ transactionId: "txn_seen" }),
      transaction({ transactionId: "txn_pro", providerSubscriptionId: "sub_01", items: [{ priceKey: "pro_monthly", quantity: 1 }] }),
      transaction({ transactionId: "txn_other", items: [{ priceKey: null, quantity: 1 }] }),
    ]);
    vi.mocked(grantInterviewCredits).mockResolvedValueOnce({ granted: true }).mockResolvedValueOnce({ granted: false, reason: "already" });

    const result = await reconcileUserBilling("user_1", NOW);

    expect(result).toMatchObject({ customer: true, transactions: 4, granted: 1 });
    expect(listProviderTransactions).toHaveBeenCalledWith("ctm_01");
    expect(grantInterviewCredits).toHaveBeenCalledTimes(2);
    expect(grantInterviewCredits).toHaveBeenCalledWith("user_1", { units: 4, transactionId: "txn_pack", now: NOW });
    expect(grantInterviewCredits).toHaveBeenCalledWith("user_1", { units: 4, transactionId: "txn_seen", now: NOW });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("transaction=txn_pack: 4 credit(s) granted now"));
  });

  it("reads no transactions for a user without a customer", async () => {
    vi.mocked(findBillingCustomer).mockResolvedValue(null);
    expect(await reconcileUserBilling("user_1", NOW)).toMatchObject({ customer: false, transactions: 0, granted: 0 });
    expect(listProviderTransactions).not.toHaveBeenCalled();
  });
});

describe("looksStale", () => {
  it("doubts a granting row whose period ended more than an hour ago, or whose scheduled cancellation should have landed", () => {
    expect(looksStale(mirrored(), NOW)).toBe(true); // period ended Nov 20, now Nov 21
    expect(looksStale(mirrored(), new Date("2026-11-20T10:30:00Z"))).toBe(false); // half an hour in
    expect(looksStale(mirrored(), new Date(new Date("2026-11-20T10:00:00Z").getTime() + RECONCILE_STALE_GRACE_MS + 1))).toBe(true);
    expect(
      looksStale(mirrored({ currentPeriodEnd: new Date("2026-12-20T10:00:00Z"), cancelAtPeriodEnd: true, scheduledChangeAt: new Date("2026-11-21T09:00:00Z") }), NOW),
    ).toBe(true);
    expect(looksStale(mirrored({ currentPeriodEnd: new Date("2026-12-20T10:00:00Z") }), NOW)).toBe(false);
  });

  it("never doubts a canceled or paused row, or no row", () => {
    expect(looksStale(mirrored({ status: "CANCELED" }), NOW)).toBe(false);
    expect(looksStale(mirrored({ status: "PAUSED" }), NOW)).toBe(false);
    expect(looksStale(null, NOW)).toBe(false);
  });
});

describe("reconcileIfStale", () => {
  it("pulls only when stale and only when the subscription's slot is free, and reports whether the mirror changed", async () => {
    expect(await reconcileIfStale("user_1", standing(mirrored({ currentPeriodEnd: new Date("2026-12-20T10:00:00Z") })), NOW)).toBe(false);
    expect(claimSubscriptionReconcile).not.toHaveBeenCalled();

    vi.mocked(listProviderSubscriptions).mockResolvedValue([remote()]);
    expect(await reconcileIfStale("user_1", standing(mirrored()), NOW)).toBe(true);
    expect(claimSubscriptionReconcile).toHaveBeenCalledWith("sub_01", NOW, SUBSCRIPTION_RECONCILE_MIN_INTERVAL_MS);

    vi.mocked(claimSubscriptionReconcile).mockResolvedValueOnce(false);
    expect(await reconcileIfStale("user_1", standing(mirrored()), NOW)).toBe(false);
    expect(listProviderSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("keeps the stale mirror in force when the provider fails, and logs the user", async () => {
    vi.mocked(listProviderSubscriptions).mockRejectedValue(new Error("down"));
    expect(await reconcileIfStale("user_1", standing(mirrored()), NOW)).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("user=user_1"), expect.anything());
  });
});
