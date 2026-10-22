import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySubscriptionSnapshot,
  findUserIdByProviderCustomer,
  findUserIdByProviderSubscription,
  linkBillingCustomer,
  markSubscriptionTransaction,
} from "@/lib/database/billing";
import { grantInterviewCredits, revokeUnusedInterviewCredits } from "@/lib/database/usage";
import { userExists } from "@/lib/database/user";
import { INTERVIEW_PACK_CREDITS } from "@/lib/plans";
import { applyBillingEvent } from "./applyEvent";
import type { ParsedBillingEvent, ProviderSubscription } from "./types";

vi.mock("@/lib/database/billing", () => ({
  applySubscriptionSnapshot: vi.fn(async () => "created"),
  findUserIdByProviderCustomer: vi.fn(async () => null),
  findUserIdByProviderSubscription: vi.fn(async () => null),
  linkBillingCustomer: vi.fn(async () => "linked"),
  markSubscriptionTransaction: vi.fn(async () => true),
}));
vi.mock("@/lib/database/usage", () => ({
  grantInterviewCredits: vi.fn(async () => ({ granted: true })),
  revokeUnusedInterviewCredits: vi.fn(async () => ({ revoked: 3, outcome: "revoked" })),
}));
vi.mock("@/lib/database/user", () => ({ userExists: vi.fn(async () => true) }));

const NOW = new Date("2026-10-20T12:00:00Z");
const base = { eventId: "evt_01", type: "x", occurredAt: NOW };

const subscription = (overrides: Partial<ProviderSubscription> = {}): ProviderSubscription => ({
  providerSubscriptionId: "sub_01",
  providerCustomerId: "ctm_01",
  status: "active",
  priceKey: "pro_monthly",
  currentPeriodStart: NOW,
  currentPeriodEnd: new Date("2026-11-20T12:00:00Z"),
  cancelAtPeriodEnd: false,
  scheduledChangeAt: null,
  canceledAt: null,
  providerUpdatedAt: NOW,
  userIdHint: "user_1",
  transactionId: null,
  ...overrides,
});

const transaction = (overrides: Partial<Extract<ParsedBillingEvent, { kind: "transaction-completed" }>> = {}): ParsedBillingEvent => ({
  ...base,
  type: "transaction.completed",
  kind: "transaction-completed",
  transactionId: "txn_01",
  providerCustomerId: "ctm_01",
  providerSubscriptionId: null,
  userIdHint: "user_1",
  items: [{ priceKey: "interview_pack", quantity: 1 }],
  ...overrides,
});

const adjustment = (overrides: Partial<Extract<ParsedBillingEvent, { kind: "adjustment" }>> = {}): ParsedBillingEvent => ({
  ...base,
  type: "adjustment.updated",
  kind: "adjustment",
  adjustmentId: "adj_01",
  transactionId: "txn_01",
  providerSubscriptionId: null,
  providerCustomerId: "ctm_01",
  action: "refund",
  status: "approved",
  full: true,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findUserIdByProviderCustomer).mockResolvedValue(null);
  vi.mocked(findUserIdByProviderSubscription).mockResolvedValue(null);
  vi.mocked(userExists).mockResolvedValue(true);
  vi.mocked(applySubscriptionSnapshot).mockResolvedValue("created");
  vi.mocked(grantInterviewCredits).mockResolvedValue({ granted: true });
  vi.mocked(revokeUnusedInterviewCredits).mockResolvedValue({ revoked: 3, outcome: "revoked" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("finding the user", () => {
  it("prefers the customer mapping, then the signed hint of a live account, then the mirrored subscription", async () => {
    vi.mocked(findUserIdByProviderCustomer).mockResolvedValueOnce("user_mapped");
    expect((await applyBillingEvent({ ...base, type: "subscription.updated", kind: "subscription", subscription: subscription() }, NOW)).userId).toBe("user_mapped");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("the mapping wins"));

    expect((await applyBillingEvent({ ...base, type: "subscription.updated", kind: "subscription", subscription: subscription() }, NOW)).userId).toBe("user_1");

    vi.mocked(userExists).mockResolvedValueOnce(false);
    vi.mocked(findUserIdByProviderSubscription).mockResolvedValueOnce("user_from_sub");
    expect((await applyBillingEvent({ ...base, type: "subscription.updated", kind: "subscription", subscription: subscription() }, NOW)).userId).toBe("user_from_sub");
  });

  it("acknowledges an event for no user (a deleted account) without writing", async () => {
    vi.mocked(userExists).mockResolvedValue(false);
    const outcome = await applyBillingEvent({ ...base, type: "subscription.updated", kind: "subscription", subscription: subscription() }, NOW);
    expect(outcome).toEqual({ userId: null, action: "subscription sub_01: no user, acknowledged" });
    expect(applySubscriptionSnapshot).not.toHaveBeenCalled();
    expect(linkBillingCustomer).not.toHaveBeenCalled();
  });
});

describe("subscription events", () => {
  it("links the customer and mirrors the snapshot; a stale one reports as such", async () => {
    const snapshot = subscription({ status: "canceled" });
    const event: ParsedBillingEvent = { ...base, type: "subscription.canceled", kind: "subscription", subscription: snapshot };

    expect(await applyBillingEvent(event, NOW)).toEqual({ userId: "user_1", action: "subscription sub_01 canceled: created" });
    expect(linkBillingCustomer).toHaveBeenCalledWith("user_1", "ctm_01");
    expect(applySubscriptionSnapshot).toHaveBeenCalledWith("user_1", snapshot);

    vi.mocked(applySubscriptionSnapshot).mockResolvedValueOnce("stale");
    expect((await applyBillingEvent(event, NOW)).action).toBe("subscription sub_01 canceled: stale");
  });
});

describe("completed transactions", () => {
  it("grants the pack's credits once, by the transaction id", async () => {
    expect(await applyBillingEvent(transaction(), NOW)).toEqual({ userId: "user_1", action: `transaction txn_01: ${INTERVIEW_PACK_CREDITS} credit(s) granted` });
    expect(grantInterviewCredits).toHaveBeenCalledWith("user_1", { units: INTERVIEW_PACK_CREDITS, transactionId: "txn_01", now: NOW });

    vi.mocked(grantInterviewCredits).mockResolvedValueOnce({ granted: false });
    expect((await applyBillingEvent(transaction(), NOW)).action).toBe("transaction txn_01: credits already granted");
  });

  it("grants nothing for a subscription payment, but links the customer and names the transaction on the mirrored subscription", async () => {
    const outcome = await applyBillingEvent(transaction({ items: [{ priceKey: "pro_monthly", quantity: 1 }], providerSubscriptionId: "sub_01" }), NOW);
    expect(outcome.action).toBe("transaction txn_01 completed: nothing to grant");
    expect(grantInterviewCredits).not.toHaveBeenCalled();
    expect(linkBillingCustomer).toHaveBeenCalledWith("user_1", "ctm_01");
    expect(markSubscriptionTransaction).toHaveBeenCalledWith("sub_01", "txn_01");

    // A pack has no subscription: nothing to name.
    await applyBillingEvent(transaction(), NOW);
    expect(markSubscriptionTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("adjustments", () => {
  it("an approved refund or chargeback of a pack revokes the unused credits, keyed by the adjustment", async () => {
    vi.mocked(findUserIdByProviderCustomer).mockResolvedValue("user_1");
    expect(await applyBillingEvent(adjustment(), NOW)).toEqual({ userId: "user_1", action: "refund of pack txn_01: 3 unused credit(s) revoked (revoked)" });
    expect(revokeUnusedInterviewCredits).toHaveBeenCalledWith("user_1", { transactionId: "txn_01", adjustmentId: "adj_01", now: NOW });

    expect((await applyBillingEvent(adjustment({ action: "chargeback", type: "adjustment.created" }), NOW)).action).toContain("chargeback of pack txn_01");
  });

  it("logs a refund of a subscription payment and claws nothing back", async () => {
    vi.mocked(findUserIdByProviderCustomer).mockResolvedValue("user_1");
    const outcome = await applyBillingEvent(adjustment({ providerSubscriptionId: "sub_01" }), NOW);
    expect(outcome.action).toBe("refund of subscription payment txn_01: logged, usage kept");
    expect(revokeUnusedInterviewCredits).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("usage not clawed back"));
  });

  it("records a pending, rejected or credit adjustment without applying anything", async () => {
    vi.mocked(findUserIdByProviderCustomer).mockResolvedValue("user_1");
    for (const [action, status] of [["refund", "pending_approval"], ["refund", "rejected"], ["credit", "approved"], ["other", "approved"]] as const) {
      const outcome = await applyBillingEvent(adjustment({ action, status }), NOW);
      expect(outcome.action).toBe(`adjustment adj_01 ${action} ${status}: recorded, nothing applied`);
    }
    expect(revokeUnusedInterviewCredits).not.toHaveBeenCalled();
  });

  it("a refund of something that was not a pack revokes nothing", async () => {
    vi.mocked(findUserIdByProviderCustomer).mockResolvedValue("user_1");
    vi.mocked(revokeUnusedInterviewCredits).mockResolvedValueOnce({ revoked: 0, outcome: "no-grant" });
    expect((await applyBillingEvent(adjustment(), NOW)).action).toBe("refund of transaction txn_01: not a pack, nothing revoked");
  });
});

describe("ignored events", () => {
  it("are recorded and nothing else", async () => {
    expect(await applyBillingEvent({ ...base, type: "customer.created", kind: "ignored" }, NOW)).toEqual({ userId: null, action: "ignored" });
  });
});
