import { ApiError } from "@paddle/paddle-node-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PADDLE_CALL_TIMEOUT_MS,
  paddleCall,
  paddleClient,
  paddleErrorCode,
  readPaddleConfig,
  readPaddleEnvironment,
  toBillingError,
} from "./client";

const SANDBOX_KEY = "pdl_sdbx_apikey_test0000000000000000";
const LIVE_KEY = "pdl_live_apikey_test0000000000000000";

/** A fetch that records the URL and answers an empty product, so the SDK call resolves without a network. */
function stubFetch() {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      calls.push(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url));
      return new Response(JSON.stringify({ data: { id: "pro_1", name: "x", tax_category: "saas", status: "active", type: "standard", description: null, image_url: null, custom_data: null, created_at: "", updated_at: "", import_meta: null }, meta: { request_id: "r" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv("PADDLE_ENV", "sandbox");
  vi.stubEnv("PADDLE_API_KEY", SANDBOX_KEY);
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", "");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the environment", () => {
  it("has no default: missing or misspelt PADDLE_ENV is a misconfiguration, never production", () => {
    for (const value of ["", "Sandbox", "prod", "live", "test"]) {
      vi.stubEnv("PADDLE_ENV", value);
      expect(() => readPaddleEnvironment()).toThrow(expect.objectContaining({ code: "BILLING_MISCONFIGURED" }));
    }
    vi.stubEnv("PADDLE_ENV", "sandbox");
    expect(readPaddleEnvironment()).toBe("sandbox");
    vi.stubEnv("PADDLE_ENV", "production");
    expect(readPaddleEnvironment()).toBe("production");
  });

  it("refuses a key from the other environment", () => {
    vi.stubEnv("PADDLE_API_KEY", LIVE_KEY);
    expect(() => readPaddleConfig()).toThrow(expect.objectContaining({ code: "BILLING_MISCONFIGURED" }));

    vi.stubEnv("PADDLE_ENV", "production");
    vi.stubEnv("PADDLE_API_KEY", SANDBOX_KEY);
    expect(() => readPaddleConfig()).toThrow(expect.objectContaining({ code: "BILLING_MISCONFIGURED" }));

    vi.stubEnv("PADDLE_API_KEY", "");
    expect(() => readPaddleConfig()).toThrow(expect.objectContaining({ code: "BILLING_MISCONFIGURED" }));
  });

  it("sends sandbox calls to the sandbox host and production calls to the live host, from PADDLE_ENV alone", async () => {
    const calls = stubFetch();

    await paddleClient().products.get("pro_1");
    expect(calls[0].host).toBe("sandbox-api.paddle.com");

    vi.stubEnv("PADDLE_ENV", "production");
    vi.stubEnv("PADDLE_API_KEY", LIVE_KEY);
    await paddleClient().products.get("pro_1");
    expect(calls[1].host).toBe("api.paddle.com");
  });

  it("reads the webhook secret as null when unset, so the webhook route can refuse to verify", () => {
    expect(readPaddleConfig().webhookSecret).toBeNull();
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "pdl_ntfset_secret");
    expect(readPaddleConfig().webhookSecret).toBe("pdl_ntfset_secret");
  });
});

const apiError = (type: string, code: string, retryAfter: number | null = null) =>
  new ApiError({ type, code, detail: "the request body, which must not travel", documentation_url: "" }, retryAfter);

describe("paddleCall and the error taxonomy", () => {
  it("maps a 4xx request error to misconfiguration and a 5xx or 429 to unavailable, keeping no detail", () => {
    expect(toBillingError(apiError("request_error", "price_not_found"), "x")).toMatchObject({ code: "BILLING_MISCONFIGURED" });
    expect(toBillingError(apiError("api_error", "internal_error"), "x")).toMatchObject({ code: "BILLING_UNAVAILABLE" });
    expect(toBillingError(apiError("request_error", "too_many_requests", 30), "x")).toMatchObject({ code: "BILLING_UNAVAILABLE" });
    expect(toBillingError(new TypeError("fetch failed"), "x")).toMatchObject({ code: "BILLING_UNAVAILABLE" });
    const mapped = toBillingError(apiError("request_error", "price_not_found"), "x");
    expect(mapped.message).not.toContain("request body");
    expect(mapped.cause).toBeUndefined();
  });

  it("keeps the provider's code readable on a mapped failure, so callers can tell forbidden from the rest", async () => {
    const mapped = await paddleCall("notification setting create", () => Promise.reject(apiError("request_error", "forbidden"))).catch((e) => e);
    expect(mapped).toMatchObject({ code: "BILLING_MISCONFIGURED" });
    expect(paddleErrorCode(mapped)).toBe("forbidden");
    expect(paddleErrorCode(apiError("request_error", "subscription_is_canceled"))).toBe("subscription_is_canceled");
    expect(paddleErrorCode(new Error("network"))).toBeNull();
    expect(paddleErrorCode(null)).toBeNull();
  });

  it("bounds the wait: a call that never answers becomes BILLING_UNAVAILABLE", async () => {
    vi.useFakeTimers();
    const pending = paddleCall("transaction create", () => new Promise<never>(() => {}));
    const outcome = pending.catch((error) => error);
    await vi.advanceTimersByTimeAsync(PADDLE_CALL_TIMEOUT_MS + 1);
    expect(await outcome).toMatchObject({ code: "BILLING_UNAVAILABLE" });
  });

  it("passes a resolved value through and clears the timer", async () => {
    vi.useFakeTimers();
    expect(await paddleCall("x", async () => 42)).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });
});
