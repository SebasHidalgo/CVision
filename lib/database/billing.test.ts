import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import type { ProviderSubscription } from "@/lib/billing/types";
import {
  applySubscriptionSnapshot,
  BILLING_EVENT_CLAIM_STALE_MS,
  claimBillingEvent,
  linkBillingCustomer,
  markBillingEventProcessed,
  markSubscriptionTransaction,
  releaseBillingEvent,
  resolvePlanStanding,
  transactionApplied,
} from "./billing";

vi.mock("@/lib/prisma", () => ({
  default: {
    billingCustomer: { create: vi.fn(), findUnique: vi.fn() },
    subscription: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    usageEvent: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    billingEvent: { create: vi.fn(), updateMany: vi.fn() },
  },
}));

const unique = () => new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });

const NOW = new Date("2026-10-20T12:00:00Z");

const snapshot = (overrides: Partial<ProviderSubscription> = {}): ProviderSubscription => ({
  providerSubscriptionId: "sub_01",
  providerCustomerId: "ctm_01",
  status: "active",
  priceKey: "pro_monthly",
  currentPeriodStart: new Date("2026-10-20T10:00:00Z"),
  currentPeriodEnd: new Date("2026-11-20T10:00:00Z"),
  cancelAtPeriodEnd: false,
  scheduledChangeAt: null,
  canceledAt: null,
  providerUpdatedAt: new Date("2026-10-20T10:00:05Z"),
  userIdHint: "user_1",
  transactionId: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("linkBillingCustomer", () => {
  it("links a new pair, treats the same pair again as already linked, and refuses a contradicting one", async () => {
    vi.mocked(prisma.billingCustomer.create).mockResolvedValueOnce({} as never);
    expect(await linkBillingCustomer("user_1", "ctm_01")).toBe("linked");

    vi.mocked(prisma.billingCustomer.create).mockRejectedValue(unique());
    vi.mocked(prisma.billingCustomer.findUnique).mockResolvedValueOnce({ providerCustomerId: "ctm_01" } as never);
    expect(await linkBillingCustomer("user_1", "ctm_01")).toBe("already");

    vi.mocked(prisma.billingCustomer.findUnique).mockResolvedValueOnce({ providerCustomerId: "ctm_other" } as never);
    expect(await linkBillingCustomer("user_1", "ctm_01")).toBe("conflict");
    vi.mocked(prisma.billingCustomer.findUnique).mockResolvedValueOnce(null);
    expect(await linkBillingCustomer("user_2", "ctm_01")).toBe("conflict");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("user=user_2 customer=ctm_01"));
  });
});

describe("applySubscriptionSnapshot", () => {
  it("creates the mirror row with the status as the enum and the price key", async () => {
    vi.mocked(prisma.subscription.create).mockResolvedValueOnce({} as never);

    expect(await applySubscriptionSnapshot("user_1", snapshot({ status: "past_due" }))).toBe("created");
    expect(prisma.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        providerSubscriptionId: "sub_01",
        status: "PAST_DUE",
        priceKey: "pro_monthly",
        currentPeriodEnd: new Date("2026-11-20T10:00:00Z"),
        providerUpdatedAt: new Date("2026-10-20T10:00:05Z"),
      }),
    });
  });

  it("applies a newer snapshot to an existing row only when the provider's time is newer, never moving the user", async () => {
    vi.mocked(prisma.subscription.create).mockRejectedValue(unique());
    vi.mocked(prisma.subscription.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    expect(await applySubscriptionSnapshot("user_1", snapshot({ status: "canceled" }))).toBe("applied");
    const call = vi.mocked(prisma.subscription.updateMany).mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(call.where).toEqual({
      providerSubscriptionId: "sub_01",
      providerUpdatedAt: { lt: new Date("2026-10-20T10:00:05Z") },
    });
    expect(call.data).not.toHaveProperty("userId");

    // The same instant, or an older one, is a repeat or an out-of-order delivery.
    expect(await applySubscriptionSnapshot("user_1", snapshot())).toBe("stale");
  });

  it("keeps the transaction the created event names, and never blanks it from a later event", async () => {
    vi.mocked(prisma.subscription.create).mockResolvedValueOnce({} as never);
    await applySubscriptionSnapshot("user_1", snapshot({ transactionId: "txn_01" }));
    expect(prisma.subscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({ transactionId: "txn_01" }) });

    vi.mocked(prisma.subscription.create).mockRejectedValueOnce(unique());
    vi.mocked(prisma.subscription.updateMany).mockResolvedValueOnce({ count: 1 });
    await applySubscriptionSnapshot("user_1", snapshot({ status: "canceled", providerUpdatedAt: new Date("2026-10-21T10:00:05Z") }));
    const call = vi.mocked(prisma.subscription.updateMany).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty("transactionId");
  });

  it("stores an unknown price as such", async () => {
    vi.mocked(prisma.subscription.create).mockResolvedValueOnce({} as never);
    await applySubscriptionSnapshot("user_1", snapshot({ priceKey: null }));
    expect(prisma.subscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({ priceKey: "unknown" }) });
  });
});

describe("the transaction behind a checkout", () => {
  it("is named on the mirrored subscription once, from whichever event arrives first", async () => {
    vi.mocked(prisma.subscription.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await markSubscriptionTransaction("sub_01", "txn_01")).toBe(true);
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { providerSubscriptionId: "sub_01", transactionId: null },
      data: { transactionId: "txn_01" },
    });
    expect(await markSubscriptionTransaction("sub_01", "txn_02")).toBe(false);
  });

  it("counts as applied when the pack grant keyed by it exists, or the subscription it opened is the user's", async () => {
    vi.mocked(prisma.usageEvent.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
    expect(await transactionApplied("user_1", "txn_01")).toBe(false);
    expect(prisma.usageEvent.findFirst).toHaveBeenCalledWith({
      where: { userId: "user_1", kind: "INTERVIEW_CREDIT_GRANT", refId: "txn_01" },
      select: { id: true },
    });
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({ where: { userId: "user_1", transactionId: "txn_01" }, select: { id: true } });

    vi.mocked(prisma.usageEvent.findFirst).mockResolvedValueOnce({ id: "evt_grant" } as never);
    expect(await transactionApplied("user_1", "txn_01")).toBe(true);

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: "row_1" } as never);
    expect(await transactionApplied("user_1", "txn_01")).toBe(true);
  });
});

describe("resolvePlanStanding", () => {
  it("derives the plan from the comp and the mirrored subscriptions", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ compPlan: null } as never);
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      {
        id: "row_1",
        providerSubscriptionId: "sub_01",
        status: "ACTIVE",
        priceKey: "pro_monthly",
        currentPeriodStart: new Date("2026-10-20T10:00:00Z"),
        currentPeriodEnd: new Date("2026-11-20T10:00:00Z"),
        cancelAtPeriodEnd: false,
        scheduledChangeAt: null,
        canceledAt: null,
        providerUpdatedAt: NOW,
      },
    ] as never);

    expect(await resolvePlanStanding("user_1", NOW)).toMatchObject({ plan: "PRO", source: "subscription" });

    vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ compPlan: "PRO" } as never);
    expect(await resolvePlanStanding("user_1", NOW)).toMatchObject({ plan: "PRO", source: "comp", everSubscribed: false });

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(await resolvePlanStanding("user_x", NOW)).toMatchObject({ plan: "FREE", source: "free" });
  });
});

describe("the event trail", () => {
  const event = { eventId: "evt_01", type: "subscription.updated", occurredAt: NOW };

  it("claims a new event by inserting it, and a repeat of a processed or live claim is a duplicate", async () => {
    vi.mocked(prisma.billingEvent.create).mockResolvedValueOnce({} as never);
    expect(await claimBillingEvent(event, NOW)).toBe("claimed");
    expect(prisma.billingEvent.create).toHaveBeenCalledWith({
      data: { providerEventId: "evt_01", type: "subscription.updated", occurredAt: NOW, claimedAt: NOW },
    });

    vi.mocked(prisma.billingEvent.create).mockRejectedValue(unique());
    vi.mocked(prisma.billingEvent.updateMany).mockResolvedValueOnce({ count: 0 });
    expect(await claimBillingEvent(event, NOW)).toBe("duplicate");
    expect(prisma.billingEvent.updateMany).toHaveBeenCalledWith({
      where: {
        providerEventId: "evt_01",
        processedAt: null,
        OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(NOW.getTime() - BILLING_EVENT_CLAIM_STALE_MS) } }],
      },
      data: { claimedAt: NOW },
    });
  });

  it("lets a retry take over a stale or released claim", async () => {
    vi.mocked(prisma.billingEvent.create).mockRejectedValue(unique());
    vi.mocked(prisma.billingEvent.updateMany).mockResolvedValueOnce({ count: 1 });
    expect(await claimBillingEvent(event, NOW)).toBe("claimed");
  });

  it("marks an event processed with the user it applied to, and releases one that failed", async () => {
    vi.mocked(prisma.billingEvent.updateMany).mockResolvedValue({ count: 1 });
    await markBillingEventProcessed("evt_01", "user_1", NOW);
    expect(prisma.billingEvent.updateMany).toHaveBeenCalledWith({ where: { providerEventId: "evt_01" }, data: { processedAt: NOW, userId: "user_1" } });

    await releaseBillingEvent("evt_01");
    expect(prisma.billingEvent.updateMany).toHaveBeenCalledWith({ where: { providerEventId: "evt_01", processedAt: null }, data: { claimedAt: null } });
  });
});
