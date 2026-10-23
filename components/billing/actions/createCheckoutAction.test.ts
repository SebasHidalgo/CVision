import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout, createPortalSession } from "@/lib/billing";
import type { SubscriptionStanding } from "@/lib/billing/access";
import { listSubscriptionRows, resolvePlanStanding } from "@/lib/database/billing";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { NoBillingAccountError, RateLimitedError } from "@/lib/error/errors";
import { createCheckoutAction } from "./createCheckoutAction";
import { createPortalSessionAction } from "./createPortalSessionAction";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("@/lib/database/user", () => ({ ensureUser: vi.fn(async () => "user_1") }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/database/billing", () => ({ listSubscriptionRows: vi.fn(async () => []), resolvePlanStanding: vi.fn() }));
vi.mock("@/lib/billing", () => ({
  createCheckout: vi.fn(async () => ({ transactionId: "txn_01" })),
  createPortalSession: vi.fn(async () => ({ url: "https://portal.example/overview" })),
}));

const row = (status: SubscriptionStanding["status"]): SubscriptionStanding => ({
  id: "row_1",
  providerSubscriptionId: "sub_01",
  status,
  priceKey: "pro_monthly",
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  scheduledChangeAt: null,
  canceledAt: null,
  providerUpdatedAt: new Date(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertRateLimit).mockResolvedValue(undefined);
  vi.mocked(listSubscriptionRows).mockResolvedValue([]);
  vi.mocked(resolvePlanStanding).mockResolvedValue({ plan: "FREE", source: "free", subscription: null, everSubscribed: false });
  vi.mocked(createCheckout).mockResolvedValue({ transactionId: "txn_01" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createCheckoutAction", () => {
  it("mints a Pro checkout for the caller, rate-limited, and returns only the transaction id", async () => {
    expect(await createCheckoutAction({ item: "pro_monthly" })).toEqual({ ok: true, data: { transactionId: "txn_01" } });
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "checkout");
    expect(createCheckout).toHaveBeenCalledWith("user_1", "pro_monthly");
  });

  it("refuses a second Pro while any subscription is open, and allows one after a cancellation landed", async () => {
    for (const status of ["ACTIVE", "TRIALING", "PAST_DUE", "PAUSED"] as const) {
      vi.mocked(listSubscriptionRows).mockResolvedValueOnce([row(status)]);
      expect(await createCheckoutAction({ item: "pro_monthly" })).toEqual({ ok: false, code: "ALREADY_SUBSCRIBED" });
    }
    vi.mocked(listSubscriptionRows).mockResolvedValueOnce([row("CANCELED")]);
    expect((await createCheckoutAction({ item: "pro_monthly" })).ok).toBe(true);
    expect(createCheckout).toHaveBeenCalledTimes(1);
  });

  it("refuses the pack without an active Pro, comped or subscribed", async () => {
    expect(await createCheckoutAction({ item: "interview_pack" })).toEqual({ ok: false, code: "PACK_REQUIRES_PRO" });
    expect(createCheckout).not.toHaveBeenCalled();

    vi.mocked(resolvePlanStanding).mockResolvedValueOnce({ plan: "PRO", source: "comp", subscription: null, everSubscribed: false });
    expect(await createCheckoutAction({ item: "interview_pack" })).toEqual({ ok: true, data: { transactionId: "txn_01" } });
    expect(createCheckout).toHaveBeenCalledWith("user_1", "interview_pack");
  });

  it("answers INVALID_INPUT for an item that is not sold, and RATE_LIMITED before anything else", async () => {
    expect(await createCheckoutAction({ item: "pro_yearly" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    vi.mocked(assertRateLimit).mockRejectedValueOnce(new RateLimitedError(120));
    expect(await createCheckoutAction({ item: "pro_monthly" })).toEqual({ ok: false, code: "RATE_LIMITED", meta: { retryAfter: 120 } });
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("passes the provider's refusal through as its code, never a message", async () => {
    vi.mocked(createCheckout).mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "x" }));
    expect(await createCheckoutAction({ item: "pro_monthly" })).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("createPortalSessionAction", () => {
  it("mints a portal link for the caller, rate-limited", async () => {
    expect(await createPortalSessionAction()).toEqual({ ok: true, data: { url: "https://portal.example/overview" } });
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "portal");
    expect(createPortalSession).toHaveBeenCalledWith("user_1");
  });

  it("answers NO_BILLING_ACCOUNT for an account that never checked out", async () => {
    vi.mocked(createPortalSession).mockRejectedValueOnce(new NoBillingAccountError());
    expect(await createPortalSessionAction()).toEqual({ ok: false, code: "NO_BILLING_ACCOUNT" });
  });
});
