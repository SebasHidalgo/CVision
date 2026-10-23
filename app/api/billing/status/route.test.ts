import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { billingStatus, type BillingStatus } from "@/lib/database/usage";
import { RateLimitedError, UnauthorizedError } from "@/lib/error/errors";
import { billingStatusSnapshotSchema } from "@/lib/schemas/billingSchema";
import { GET } from "./route";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
// The lean status read is stubbed; nothing else is imported, so a poll has no
// path to the provider at all (the adapter is not even in this module graph).
vi.mock("@/lib/database/usage", () => ({ billingStatus: vi.fn() }));

const TXN = "txn_01m5jdjv22mnssacjx9vbys9cv";

const status = (overrides: Partial<BillingStatus> = {}): BillingStatus => ({
  plan: "PRO",
  subscription: {
    id: "row_1",
    providerSubscriptionId: "sub_01",
    status: "ACTIVE",
    priceKey: "pro_monthly",
    currentPeriodStart: new Date("2026-10-05T00:00:00Z"),
    currentPeriodEnd: new Date("2026-11-05T00:00:00Z"),
    cancelAtPeriodEnd: true,
    scheduledChangeAt: new Date("2026-11-05T00:00:00Z"),
    canceledAt: null,
    providerUpdatedAt: new Date("2026-10-20T00:00:00Z"),
  },
  periodEnd: new Date("2026-11-05T00:00:00Z"),
  credits: 5,
  transactionApplied: null,
  ...overrides,
});

async function get(query = "") {
  const response = await GET(new NextRequest(`http://localhost/api/billing/status${query}`));
  return { status: response.status, body: (await response.json()) as { ok: boolean; data?: unknown; code?: string } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(assertRateLimit).mockResolvedValue(undefined);
  vi.mocked(billingStatus).mockResolvedValue(status());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/billing/status", () => {
  it("answers the snapshot the account page polls for, in the shape the client validates", async () => {
    const { status: code, body } = await get();
    expect(code).toBe(200);
    expect(body.ok).toBe(true);
    expect(billingStatusSnapshotSchema.parse(body.data)).toEqual({
      plan: "PRO",
      subscriptionStatus: "ACTIVE",
      cancelAtPeriodEnd: true,
      periodEnd: "2026-11-05T00:00:00.000Z",
      credits: 5,
      transactionApplied: null,
    });
    expect(billingStatus).toHaveBeenCalledWith("user_1", { transactionId: null, item: null });
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "status");
  });

  it("asks whether the named transaction was applied, with what it bought, and ignores a malformed id or item", async () => {
    vi.mocked(billingStatus).mockResolvedValueOnce(status({ transactionApplied: true }));
    const { body } = await get(`?transactionId=${TXN}&item=pro_monthly`);
    expect(billingStatus).toHaveBeenCalledWith("user_1", { transactionId: TXN, item: "pro_monthly" });
    expect(body.data).toMatchObject({ transactionApplied: true });

    await get("?transactionId=txn_short&item=something");
    expect(billingStatus).toHaveBeenLastCalledWith("user_1", { transactionId: null, item: null });
  });

  it("describes a Free account without a subscription", async () => {
    vi.mocked(billingStatus).mockResolvedValue(status({ plan: "FREE", subscription: null, credits: 0, periodEnd: new Date("2026-11-01T00:00:00Z") }));
    const { body } = await get();
    expect(body.data).toEqual({ plan: "FREE", subscriptionStatus: null, cancelAtPeriodEnd: false, periodEnd: "2026-11-01T00:00:00.000Z", credits: 0, transactionApplied: null });
  });

  it("answers 401 without a session and 429 with Retry-After past the ceiling", async () => {
    vi.mocked(requireUserId).mockRejectedValueOnce(new UnauthorizedError());
    expect((await get()).status).toBe(401);

    vi.mocked(assertRateLimit).mockRejectedValueOnce(new RateLimitedError(12));
    const response = await GET(new NextRequest("http://localhost/api/billing/status"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
  });
});
