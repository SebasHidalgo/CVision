import { beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG } from "@/lib/billing/catalog";
import { SUBSCRIBED_EVENTS } from "./catalog";
import { runPaddleDoctor, UNPROVABLE_WRITES } from "./doctor";

/**
 * The doctor against a stubbed Paddle: every request is answered from a
 * table keyed by method and path, so each check can be driven to pass or
 * fail, and the one non-SDK call (the checkout settings) is seen to go to
 * the environment's host with the key.
 */

const API_KEY = "pdl_sdbx_apikey_test0000000000000000";
const SECRET = "pdl_ntfset_test_secret_0123456789";
const WEBHOOK_URL = "https://tunnel.example/api/webhooks/paddle";

type Answer = { status?: number; body: unknown };
type Table = Record<string, Answer | ((url: URL) => Answer)>;

const page = (data: unknown[]) => ({ data, meta: { request_id: "r", pagination: { per_page: 1, next: "", has_more: false, estimated_total: data.length } } });
const forbidden = (): Answer => ({ status: 403, body: { error: { type: "request_error", code: "forbidden", detail: "You are not permitted to perform this request.", documentation_url: "" }, meta: { request_id: "r" } } });

const customer = { id: "ctm_01", name: null, email: "x@example.com", marketing_consent: false, status: "active", custom_data: null, locale: "en", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", import_meta: null };
const destination = (overrides: Record<string, unknown> = {}) => ({
  id: "ntfset_01",
  description: "CVision",
  type: "url",
  destination: WEBHOOK_URL,
  active: true,
  api_version: 1,
  include_sensitive_fields: false,
  subscribed_events: SUBSCRIBED_EVENTS.map((name) => ({ name, description: name, group: name.split(".")[0], available_versions: [1] })),
  endpoint_secret_key: SECRET,
  traffic_source: "all",
  ...overrides,
});
const price = (id: string, key: "pro_monthly" | "interview_pack", overrides: Record<string, unknown> = {}) => ({
  id,
  product_id: "pro_1",
  description: "x",
  name: null,
  type: "standard",
  billing_cycle: key === "pro_monthly" ? { interval: "month", frequency: 1 } : null,
  trial_period: null,
  tax_mode: "account_setting",
  unit_price: { amount: CATALOG[key].amountMinor, currency_code: "USD" },
  unit_price_overrides: [],
  quantity: { minimum: 1, maximum: 1 },
  status: "active",
  custom_data: { key },
  import_meta: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...overrides,
});

/** The healthy account: every permission, a link, one destination with the secret in .env, both prices. */
function healthy(): Table {
  return {
    "GET /products": { body: page([]) },
    "GET /prices": { body: page([]) },
    "GET /customers": { body: page([customer]) },
    "GET /transactions": { body: page([]) },
    "GET /subscriptions": { body: page([]) },
    "GET /notification-settings": { body: { data: [destination()], meta: { request_id: "r" } } },
    "POST /customers/ctm_01/portal-sessions": {
      body: { data: { id: "cpls_01", customer_id: "ctm_01", urls: { general: { overview: "https://portal.example/" }, subscriptions: [] }, created_at: "2026-10-20T10:00:00Z" }, meta: { request_id: "r" } },
    },
    "GET /settings/checkout-url": { body: { data: { default_url: "https://tunnel.example/pricing" }, meta: { request_id: "r" } } },
    "GET /prices/pri_pro": { body: { data: price("pri_pro", "pro_monthly"), meta: { request_id: "r" } } },
    "GET /prices/pri_pack": { body: { data: price("pri_pack", "interview_pack"), meta: { request_id: "r" } } },
  };
}

const requests: { method: string; url: URL; headers: Record<string, string> }[] = [];

function serve(table: Table) {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const headers = Object.fromEntries(new Headers(init?.headers ?? (input instanceof Request ? input.headers : {})).entries());
      requests.push({ method, url, headers });
      const entry = table[`${method} ${url.pathname}`];
      if (!entry) return new Response(JSON.stringify({ error: { type: "request_error", code: "not_found", detail: "no stub", documentation_url: "" }, meta: { request_id: "r" } }), { status: 404, headers: { "content-type": "application/json" } });
      const answer = typeof entry === "function" ? entry(url) : entry;
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
}

const byName = (checks: Awaited<ReturnType<typeof runPaddleDoctor>>, name: string) => {
  const check = checks.find((entry) => entry.name === name);
  if (!check) throw new Error(`no check named ${name}: ${checks.map((entry) => entry.name).join(", ")}`);
  return check;
};

beforeEach(() => {
  vi.stubEnv("PADDLE_ENV", "sandbox");
  vi.stubEnv("PADDLE_API_KEY", API_KEY);
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_token");
  vi.stubEnv("PADDLE_PRICE_PRO_MONTHLY", "pri_pro");
  vi.stubEnv("PADDLE_PRICE_INTERVIEW_PACK", "pri_pack");
});

describe("billing:doctor", () => {
  it("passes a healthy sandbox, proves each read permission by a list of one and the portal by a session, and names the unprovable writes", async () => {
    serve(healthy());
    const checks = await runPaddleDoctor({ webhookUrl: WEBHOOK_URL });

    expect(checks.filter((check) => check.outcome === "fail")).toEqual([]);
    for (const permission of ["product.read", "price.read", "customer.read", "transaction.read", "subscription.read", "notification_setting.read", "customer_portal_session.write"]) {
      expect(byName(checks, `permission ${permission}`).outcome).toBe("pass");
    }
    for (const permission of Object.keys(UNPROVABLE_WRITES)) {
      expect(byName(checks, `permission ${permission}`)).toMatchObject({ outcome: "skip", fix: expect.stringContaining(permission) });
    }
    expect(byName(checks, "default payment link")).toMatchObject({ outcome: "pass", detail: "set to https://tunnel.example/pricing" });
    expect(byName(checks, "webhook destination").outcome).toBe("pass");
    expect(byName(checks, "webhook secret").outcome).toBe("pass");
    expect(byName(checks, "price pro_monthly")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("1500 USD per month") });
    expect(byName(checks, "price interview_pack")).toMatchObject({ outcome: "pass", detail: expect.stringContaining("900 USD one-time") });

    // Every list asked for one item; the settings read went to the sandbox host with the key and never elsewhere.
    for (const request of requests.filter((entry) => entry.method === "GET" && /\/(products|prices|customers|transactions|subscriptions)$/.test(entry.url.pathname))) {
      expect(request.url.searchParams.get("per_page")).toBe("1");
    }
    const settings = requests.find((entry) => entry.url.pathname === "/settings/checkout-url");
    expect(settings?.url.host).toBe("sandbox-api.paddle.com");
    expect(settings?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(requests.every((entry) => entry.url.host === "sandbox-api.paddle.com")).toBe(true);
    // Nothing secret in any line.
    for (const check of checks) expect(`${check.detail} ${check.fix ?? ""}`).not.toContain(SECRET);
  });

  it("names the missing portal permission with the dashboard fix, which is what the owner's live test hit", async () => {
    serve({ ...healthy(), "POST /customers/ctm_01/portal-sessions": forbidden() });
    const check = byName(await runPaddleDoctor({ webhookUrl: WEBHOOK_URL }), "permission customer_portal_session.write");
    expect(check).toMatchObject({ outcome: "fail", detail: "the API key lacks customer_portal_session.write (Paddle answered forbidden)" });
    expect(check.fix).toMatch(/Developer tools > Authentication/);
  });

  it("fails the default payment link when it is unset, and says how to check by hand when the key may not read the settings", async () => {
    serve({ ...healthy(), "GET /settings/checkout-url": { body: { data: { default_url: null }, meta: { request_id: "r" } } } });
    let check = byName(await runPaddleDoctor({ webhookUrl: WEBHOOK_URL }), "default payment link");
    expect(check.outcome).toBe("fail");
    expect(check.detail).toContain("transaction_default_checkout_url_not_set");
    expect(check.fix).toMatch(/Sandbox: any https URL/);
    expect(check.fix).toMatch(/Production: only a domain approved/);

    serve({ ...healthy(), "GET /settings/checkout-url": forbidden() });
    check = byName(await runPaddleDoctor({ webhookUrl: WEBHOOK_URL }), "default payment link");
    expect(check).toMatchObject({ outcome: "fail", detail: expect.stringContaining("checkout_settings.read") });
    expect(check.fix).toMatch(/check by hand/);
  });

  it("checks the destination's URL, events, activity and secret, and refuses two destinations for the route", async () => {
    serve({ ...healthy(), "GET /notification-settings": { body: { data: [], meta: { request_id: "r" } } } });
    expect(byName(await runPaddleDoctor({ webhookUrl: WEBHOOK_URL }), "webhook destination")).toMatchObject({ outcome: "fail", fix: expect.stringContaining("billing:sync -- --webhook-url") });

    serve({
      ...healthy(),
      "GET /notification-settings": { body: { data: [destination({ destination: "https://old.example/api/webhooks/paddle", active: false, subscribed_events: [] })], meta: { request_id: "r" } } },
    });
    const stale = byName(await runPaddleDoctor({ webhookUrl: WEBHOOK_URL }), "webhook destination");
    expect(stale.outcome).toBe("fail");
    expect(stale.detail).toMatch(/points at https:\/\/old.example/);
    expect(stale.detail).toMatch(/inactive/);
    expect(stale.detail).toMatch(/missing events/);

    serve({ ...healthy(), "GET /notification-settings": { body: { data: [destination({ endpoint_secret_key: "pdl_ntfset_other" })], meta: { request_id: "r" } } } });
    expect(byName(await runPaddleDoctor({ webhookUrl: WEBHOOK_URL }), "webhook secret")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("rejected with 400") });

    serve({ ...healthy(), "GET /notification-settings": { body: { data: [destination(), destination({ id: "ntfset_02", description: "by hand" })], meta: { request_id: "r" } } } });
    expect(byName(await runPaddleDoctor({ webhookUrl: WEBHOOK_URL }), "webhook destinations")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("2 destinations") });
  });

  it("compares each price id in .env with the catalog", async () => {
    serve({ ...healthy(), "GET /prices/pri_pack": { body: { data: price("pri_pack", "interview_pack", { unit_price: { amount: "1200", currency_code: "USD" }, custom_data: { key: "other" } }), meta: { request_id: "r" } } } });
    const check = byName(await runPaddleDoctor({ webhookUrl: null }), "price interview_pack");
    expect(check.outcome).toBe("fail");
    expect(check.detail).toContain("1200 USD, catalog says 900 USD");
    expect(check.detail).toContain('its key is "other"');

    vi.stubEnv("PADDLE_PRICE_INTERVIEW_PACK", "");
    expect(byName(await runPaddleDoctor({ webhookUrl: null }), "price interview_pack")).toMatchObject({ outcome: "fail", detail: "PADDLE_PRICE_INTERVIEW_PACK is not set" });
  });

  it("stops at the environment when the key is not of it, and flags a client token of the other environment", async () => {
    vi.stubEnv("PADDLE_API_KEY", "pdl_live_apikey_test0000000000000000");
    serve(healthy());
    const checks = await runPaddleDoctor({ webhookUrl: null });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: "environment", outcome: "fail" });
    expect(requests).toEqual([]);

    vi.stubEnv("PADDLE_API_KEY", API_KEY);
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "live_token");
    expect(byName(await runPaddleDoctor({ webhookUrl: null }), "client token")).toMatchObject({ outcome: "fail", detail: expect.stringContaining("not a sandbox token") });
  });
});
