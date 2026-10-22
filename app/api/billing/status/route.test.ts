import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { usageSummary, type UsageSummary } from "@/lib/database/usage";
import { RateLimitedError, UnauthorizedError } from "@/lib/error/errors";
import { billingStatusSnapshotSchema } from "@/lib/schemas/billingSchema";
import { GET } from "./route";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/database/usage", () => ({ usageSummary: vi.fn() }));

const summary = (overrides: Partial<UsageSummary> = {}): UsageSummary => ({
  plan: "PRO",
  source: "subscription",
  analyses: { used: 1, limit: 50, left: 49, announce: false },
  interviews: { used: 1, limit: 4, left: 3 },
  credits: { balance: 5, usable: true },
  trial: { available: false, used: false },
  period: { start: new Date("2026-10-05T00:00:00Z"), end: new Date("2026-11-05T00:00:00Z") },
  resetsAt: new Date("2026-11-05T00:00:00Z"),
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
  everSubscribed: true,
  hasBillingAccount: true,
  ...overrides,
});

async function get() {
  const response = await GET();
  return { status: response.status, body: (await response.json()) as { ok: boolean; data?: unknown; code?: string } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(assertRateLimit).mockResolvedValue(undefined);
  vi.mocked(usageSummary).mockResolvedValue(summary());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/billing/status", () => {
  it("answers the snapshot the account page polls for, in the shape the client validates", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(billingStatusSnapshotSchema.parse(body.data)).toEqual({
      plan: "PRO",
      subscriptionStatus: "ACTIVE",
      cancelAtPeriodEnd: true,
      periodEnd: "2026-11-05T00:00:00.000Z",
      interviewsLeft: 3,
      credits: 5,
    });
    expect(usageSummary).toHaveBeenCalledWith("user_1");
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "status");
  });

  it("describes a Free account without a subscription", async () => {
    vi.mocked(usageSummary).mockResolvedValue(
      summary({ plan: "FREE", source: "free", interviews: { used: 0, limit: 0, left: 0 }, credits: { balance: 0, usable: false }, subscription: null, resetsAt: new Date("2026-11-01T00:00:00Z") }),
    );
    const { body } = await get();
    expect(body.data).toEqual({ plan: "FREE", subscriptionStatus: null, cancelAtPeriodEnd: false, periodEnd: "2026-11-01T00:00:00.000Z", interviewsLeft: 0, credits: 0 });
  });

  it("answers 401 without a session and 429 with Retry-After past the ceiling", async () => {
    vi.mocked(requireUserId).mockRejectedValueOnce(new UnauthorizedError());
    expect((await get()).status).toBe(401);

    vi.mocked(assertRateLimit).mockRejectedValueOnce(new RateLimitedError(12));
    const response = await GET();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
  });
});
