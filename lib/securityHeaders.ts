/**
 * The response headers every page carries: a Content-Security-Policy that
 * names each third party the browser talks to and nothing else, and the
 * usual companions. Built from the environment at config load
 * (next.config.ts), so the Clerk instance, the Paddle environment and the
 * Supabase project come from the same variables the app runs on. Pure:
 * `securityHeaders.test.ts` reads the result.
 *
 * Every allowed source, and why:
 *
 *   Clerk      the instance's Frontend API host (its script, its API; from
 *              the publishable key), challenges.cloudflare.com and
 *              *.protect.clerk.com (bot sign-up protection), img.clerk.com
 *              (avatars). Clerk injects styles at runtime, so style-src
 *              keeps 'unsafe-inline'. Per Clerk's CSP guide.
 *   Paddle     cdn.paddle.com (Paddle.js), the checkout overlay's iframe
 *              origin (buy.paddle.com, or sandbox-buy.paddle.com in the
 *              sandbox), *.paddle.com for the calls Paddle.js makes and
 *              the stylesheet it loads from its environment's CDN;
 *              `payment` in Permissions-Policy for the wallets inside it.
 *              The overlay page carries Paddle's own report-only
 *              frame-ancestors for the approved domains; not ours.
 *   ElevenLabs api.elevenlabs.io (https and wss: the SDK's signalling)
 *              and *.rtc.elevenlabs.io (LiveKit, the WebRTC media) for the
 *              interview room; the microphone only on that route.
 *   ElevenLabs (continued) the SDK's audio worklets from this origin, and its
 *              resampler worklet by exact URL on cdn.jsdelivr.net.
 *   Supabase   the project's host: the browser PUTs the CV to a signed
 *              upload URL (connect-src) and the drawer embeds a signed read
 *              URL in an <object> (object-src), both minted by the server.
 *   Next.js    'unsafe-inline' scripts: the App Router's hydration and RSC
 *              payload are inline scripts without a nonce (a nonce would
 *              make every page dynamic; the legal pages are static);
 *              'unsafe-eval' in development only (the dev runtime), with
 *              the dev server's websocket.
 *
 * Mode: `Content-Security-Policy` (enforced) unless CSP_MODE=report-only,
 * which switches to `Content-Security-Policy-Report-Only` so a change can
 * be tried with the browser console as the judge.
 */

// Relative on purpose: next.config.ts loads this module at config time,
// where the `@/` alias resolves one level deep and no further.
import { LIBSAMPLERATE_WORKLET_URL } from "./elevenlabs/worklets";

export type HeaderEntry = { key: string; value: string };
export type HeaderRule = { source: string; headers: HeaderEntry[] };

export type SecurityHeadersEnv = {
  NODE_ENV?: string;
  CSP_MODE?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  PADDLE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

export type CspMode = "enforce" | "report-only";

/** The Clerk Frontend API host carried in the publishable key (base64 after the prefix, with a trailing $). */
export function clerkFrontendApi(publishableKey: string | undefined): string | null {
  const match = /^pk_(test|live)_(.+)$/.exec(publishableKey?.trim() ?? "");
  if (!match) return null;
  try {
    const host = Buffer.from(match[2], "base64").toString("utf8").replace(/\$$/, "").trim();
    return /^[a-z0-9.-]+$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function cspMode(env: SecurityHeadersEnv): CspMode {
  return env.CSP_MODE?.trim() === "report-only" ? "report-only" : "enforce";
}

/** The origin of a URL, or null when it is not one. */
function originOf(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
}

const PADDLE_CHECKOUT = { sandbox: "https://sandbox-buy.paddle.com", production: "https://buy.paddle.com" } as const;

export function contentSecurityPolicy(env: SecurityHeadersEnv): string {
  const development = env.NODE_ENV !== "production";
  const clerk = clerkFrontendApi(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const clerkHost = clerk ? `https://${clerk}` : null;
  const paddleCheckout = PADDLE_CHECKOUT[env.PADDLE_ENV === "production" ? "production" : "sandbox"];
  const supabase = originOf(env.NEXT_PUBLIC_SUPABASE_URL);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    // AudioWorklet modules count as scripts: the SDK's two processors are
    // served from this origin (lib/elevenlabs/worklets.ts), and its
    // resampler, loaded only where the microphone cannot open at the
    // requested rate, by its exact pinned URL.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(development ? ["'unsafe-eval'"] : []),
      ...(clerkHost ? [clerkHost] : []),
      "https://challenges.cloudflare.com",
      "https://*.protect.clerk.com",
      "https://cdn.paddle.com",
      LIBSAMPLERATE_WORKLET_URL,
    ],
    // Paddle.js pulls its stylesheet from the CDN of its environment
    // (sandbox-cdn.paddle.com in the sandbox): seen in the report-only run.
    "style-src": ["'self'", "'unsafe-inline'", "https://*.paddle.com"],
    "img-src": ["'self'", "data:", "blob:", "https://img.clerk.com"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(development ? ["ws://localhost:*", "http://localhost:*"] : []),
      ...(clerkHost ? [clerkHost] : []),
      "https://*.protect.clerk.com:*",
      "https://api.elevenlabs.io",
      "wss://api.elevenlabs.io",
      "https://*.rtc.elevenlabs.io",
      "wss://*.rtc.elevenlabs.io",
      "https://*.paddle.com",
      ...(supabase ? [supabase] : []),
    ],
    "frame-src": [paddleCheckout, "https://challenges.cloudflare.com", "https://*.protect.clerk.com", ...(supabase ? [supabase] : [])],
    "object-src": [...(supabase ? [supabase] : ["'none'"])],
    "media-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    ...(development ? {} : { "upgrade-insecure-requests": [] }),
  };

  return Object.entries(directives)
    .map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

/**
 * Permissions-Policy: nothing by default; the microphone for this origin
 * only; payment for Paddle's overlay (the wallets inside its iframe ask
 * the top document for it).
 *
 * The microphone cannot be limited to the room's route: a policy belongs
 * to the document, and the room is reached by a client-side navigation
 * from the analysis page, so the document that asks for the microphone
 * is the one that was served for the analysis (proved by the browser
 * suite: with `microphone=()` elsewhere, Start was refused). `self` still
 * keeps every embedded third-party frame away from it.
 */
export function permissionsPolicy(env: SecurityHeadersEnv): string {
  const paddleCheckout = PADDLE_CHECKOUT[env.PADDLE_ENV === "production" ? "production" : "sandbox"];
  return ["camera=()", "geolocation=()", "microphone=(self)", `payment=(self "${paddleCheckout}")`, "usb=()", "interest-cohort=()"].join(", ");
}

/** The rules for next.config's `headers()`: the same set on every route. */
export function securityHeaderRules(env: SecurityHeadersEnv): HeaderRule[] {
  const development = env.NODE_ENV !== "production";
  const cspHeader = cspMode(env) === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
  const common: HeaderEntry[] = [
    { key: cspHeader, value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: permissionsPolicy(env) },
    ...(development ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
  ];
  return [{ source: "/(.*)", headers: common }];
}
