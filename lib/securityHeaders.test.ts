import { describe, expect, it } from "vitest";
import { clerkFrontendApi, contentSecurityPolicy, cspMode, permissionsPolicy, securityHeaderRules } from "./securityHeaders";

const DEV_KEY = `pk_test_${Buffer.from("thankful-roughy-3.clerk.accounts.dev$").toString("base64")}`;
const LIVE_KEY = `pk_live_${Buffer.from("clerk.example.com$").toString("base64")}`;

const env = (overrides: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: LIVE_KEY,
  PADDLE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  ...overrides,
});

const directive = (csp: string, name: string) => csp.split("; ").find((part) => part.startsWith(`${name} `) || part === name) ?? "";

describe("clerkFrontendApi", () => {
  it("decodes the Frontend API host from a publishable key of either environment", () => {
    expect(clerkFrontendApi(DEV_KEY)).toBe("thankful-roughy-3.clerk.accounts.dev");
    expect(clerkFrontendApi(LIVE_KEY)).toBe("clerk.example.com");
    expect(clerkFrontendApi("nonsense")).toBeNull();
    expect(clerkFrontendApi(undefined)).toBeNull();
    expect(clerkFrontendApi(`pk_test_${Buffer.from("not a host!").toString("base64")}`)).toBeNull();
  });
});

describe("contentSecurityPolicy", () => {
  it("names every third party the browser talks to, and nothing else, in production", () => {
    const csp = contentSecurityPolicy(env());
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline' https://clerk.example.com https://challenges.cloudflare.com https://*.protect.clerk.com https://cdn.paddle.com https://cdn.jsdelivr.net/npm/@alexanderolsen/libsamplerate-js@2.1.2/dist/libsamplerate.worklet.js");
    expect(directive(csp, "connect-src")).toBe(
      "connect-src 'self' https://clerk.example.com https://*.protect.clerk.com:* https://api.elevenlabs.io wss://api.elevenlabs.io https://*.rtc.elevenlabs.io wss://*.rtc.elevenlabs.io https://*.paddle.com https://abcdefgh.supabase.co",
    );
    expect(directive(csp, "frame-src")).toBe("frame-src https://buy.paddle.com https://challenges.cloudflare.com https://*.protect.clerk.com https://abcdefgh.supabase.co");
    expect(directive(csp, "object-src")).toBe("object-src https://abcdefgh.supabase.co");
    expect(directive(csp, "img-src")).toBe("img-src 'self' data: blob: https://img.clerk.com");
    expect(directive(csp, "style-src")).toBe("style-src 'self' 'unsafe-inline' https://*.paddle.com");
    expect(directive(csp, "worker-src")).toBe("worker-src 'self' blob:");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("localhost");
  });

  it("uses the sandbox overlay origin, the dev runtime's eval and the dev server's websocket in development", () => {
    const csp = contentSecurityPolicy(env({ NODE_ENV: "development", PADDLE_ENV: "sandbox", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: DEV_KEY }));
    expect(directive(csp, "frame-src")).toContain("https://sandbox-buy.paddle.com");
    expect(directive(csp, "frame-src")).not.toContain("https://buy.paddle.com");
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "script-src")).toContain("https://thankful-roughy-3.clerk.accounts.dev");
    expect(directive(csp, "connect-src")).toContain("ws://localhost:*");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("falls back to object-src 'none' and no Clerk host when the variables are missing, never to a wildcard", () => {
    const csp = contentSecurityPolicy({ NODE_ENV: "production" });
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://*.protect.clerk.com https://cdn.paddle.com https://cdn.jsdelivr.net/npm/@alexanderolsen/libsamplerate-js@2.1.2/dist/libsamplerate.worklet.js");
    expect(csp).not.toMatch(/\s\*(\s|;|$)/);
  });
});

describe("the header rules", () => {
  it("enforce by default, report-only on request", () => {
    expect(cspMode(env())).toBe("enforce");
    expect(cspMode(env({ CSP_MODE: "report-only" }))).toBe("report-only");
    expect(securityHeaderRules(env())[0].headers[0].key).toBe("Content-Security-Policy");
    expect(securityHeaderRules(env({ CSP_MODE: "report-only" }))[0].headers[0].key).toBe("Content-Security-Policy-Report-Only");
  });

  it("deny framing, nosniff, a strict referrer, HSTS in production only, the microphone for this origin alone, one rule for every route", () => {
    const rules = securityHeaderRules(env());
    expect(rules).toHaveLength(1);
    const common = Object.fromEntries(rules[0].headers.map((header) => [header.key, header.value]));
    expect(rules[0].source).toBe("/(.*)");
    expect(common["X-Frame-Options"]).toBe("DENY");
    expect(common["X-Content-Type-Options"]).toBe("nosniff");
    expect(common["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(common["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(common["Permissions-Policy"]).toBe(permissionsPolicy(env()));
    expect(common["Permissions-Policy"]).toContain("microphone=(self)");
    expect(common["Permissions-Policy"]).toContain("camera=()");
    expect(common["Permissions-Policy"]).toContain('payment=(self "https://buy.paddle.com")');
    expect(permissionsPolicy(env({ PADDLE_ENV: "sandbox" }))).toContain('payment=(self "https://sandbox-buy.paddle.com")');

    const dev = securityHeaderRules(env({ NODE_ENV: "development" }));
    expect(dev[0].headers.some((header) => header.key === "Strict-Transport-Security")).toBe(false);
  });
});
