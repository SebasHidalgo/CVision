import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyBillingEvent } from "@/lib/billing/applyEvent";
import { signPaddleWebhook } from "@/lib/billing/paddle/webhookSignature";
import { claimBillingEvent, markBillingEventProcessed, releaseBillingEvent } from "@/lib/database/billing";
import { POST } from "./route";

// The verifier is the real adapter (the SDK's HMAC over the raw body); the
// database and the application of the event are stubbed.
vi.mock("@/lib/billing/applyEvent", () => ({ applyBillingEvent: vi.fn() }));
vi.mock("@/lib/database/billing", () => ({
  claimBillingEvent: vi.fn(async () => "claimed"),
  markBillingEventProcessed: vi.fn(async () => {}),
  releaseBillingEvent: vi.fn(async () => {}),
}));

const SECRET = "pdl_ntfset_test_secret_0123456789";

/** A customer.created event: verified, translated to "ignored", enough to drive the route. */
const body = (eventId = "evt_01") =>
  JSON.stringify({
    event_id: eventId,
    event_type: "customer.created",
    occurred_at: "2026-10-20T10:00:06Z",
    notification_id: "ntf_01",
    data: { id: "ctm_01", name: null, email: "x@example.com", marketing_consent: false, status: "active", custom_data: null, locale: "en", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", import_meta: null },
  });

async function deliver(raw: string, signature?: string) {
  const response = await POST(
    new Request("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", ...(signature ? { "paddle-signature": signature } : {}) },
      body: raw,
    }),
  );
  return response.status;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PADDLE_ENV", "sandbox");
  vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_apikey_test0000000000000000");
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
  vi.mocked(claimBillingEvent).mockResolvedValue("claimed");
  vi.mocked(applyBillingEvent).mockResolvedValue({ userId: "user_1", action: "ignored" });
  for (const method of ["info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

describe("POST /api/webhooks/paddle: verification", () => {
  it("accepts a delivery signed with the destination's secret and records it", async () => {
    const raw = body();
    expect(await deliver(raw, signPaddleWebhook(raw, SECRET))).toBe(200);
    expect(claimBillingEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_01", type: "customer.created" }));
    expect(markBillingEventProcessed).toHaveBeenCalledWith("evt_01", "user_1");
  });

  it("answers 400 to a bad signature, an altered body, a stale timestamp or a missing header, and writes nothing", async () => {
    const raw = body();
    expect(await deliver(raw, signPaddleWebhook(raw, "another-secret"))).toBe(400);
    expect(await deliver(raw.replace("ctm_01", "ctm_02"), signPaddleWebhook(raw, SECRET))).toBe(400);
    expect(await deliver(raw, signPaddleWebhook(raw, SECRET, Math.floor(Date.now() / 1000) - 60))).toBe(400);
    expect(await deliver(raw)).toBe(400);
    expect(claimBillingEvent).not.toHaveBeenCalled();
    expect(applyBillingEvent).not.toHaveBeenCalled();
  });

  it("answers 500 when the secret is not configured, so a retry after the fix succeeds", async () => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
    const raw = body();
    expect(await deliver(raw, signPaddleWebhook(raw, SECRET))).toBe(500);
  });
});

describe("POST /api/webhooks/paddle: idempotency", () => {
  it("applies a claimed event once and acknowledges a duplicate without applying it", async () => {
    const raw = body();
    expect(await deliver(raw, signPaddleWebhook(raw, SECRET))).toBe(200);
    vi.mocked(claimBillingEvent).mockResolvedValueOnce("duplicate");
    expect(await deliver(raw, signPaddleWebhook(raw, SECRET))).toBe(200);
    expect(applyBillingEvent).toHaveBeenCalledTimes(1);
  });

  it("releases the claim and answers 500 when applying fails, so the provider retries", async () => {
    vi.mocked(applyBillingEvent).mockRejectedValueOnce(new Error("db down"));
    const raw = body();
    expect(await deliver(raw, signPaddleWebhook(raw, SECRET))).toBe(500);
    expect(releaseBillingEvent).toHaveBeenCalledWith("evt_01");
    expect(markBillingEventProcessed).not.toHaveBeenCalled();
  });

  it("answers 500 when the event cannot even be recorded", async () => {
    vi.mocked(claimBillingEvent).mockRejectedValueOnce(new Error("db down"));
    const raw = body();
    expect(await deliver(raw, signPaddleWebhook(raw, SECRET))).toBe(500);
    expect(applyBillingEvent).not.toHaveBeenCalled();
  });
});
