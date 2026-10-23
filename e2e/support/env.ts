import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The environment the suite runs in: `.env` loaded into the process (the
 * same file the app reads, no second copy of any secret), and the guards
 * that keep the suite away from anything that is not a sandbox or a
 * development instance.
 */

/** Loads `.env` from the repository root into process.env, never overriding what is already set. */
export function loadEnv(file = path.resolve(process.cwd(), ".env")): void {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    const value = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

/** Where the browser goes: the local dev server unless told otherwise. */
export const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/+$/, "") || "http://localhost:3000";

/** Where the providers' webhooks arrive: the tunnel. The billing specs need it. */
export function publicUrl(): string | null {
  return process.env.E2E_PUBLIC_URL?.replace(/\/+$/, "") || null;
}

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set; the e2e suite reads it from .env`);
  return value;
}

/**
 * The suite creates accounts, pays with test cards and deletes what it
 * made. It refuses to run against anything but the Paddle sandbox and a
 * Clerk development instance.
 */
export function assertSandbox(): void {
  if (process.env.PADDLE_ENV !== "sandbox") throw new Error(`PADDLE_ENV is ${process.env.PADDLE_ENV ?? "unset"}; the e2e suite runs only against the sandbox`);
  if (!required("PADDLE_API_KEY").startsWith("pdl_sdbx_")) throw new Error("PADDLE_API_KEY is not a sandbox key");
  if (!required("CLERK_SECRET_KEY").startsWith("sk_test_")) throw new Error("CLERK_SECRET_KEY is not a development-instance key");
  if (!required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY").startsWith("pk_test_")) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a development-instance key");
}

/**
 * Whether the tunnel in E2E_PUBLIC_URL reaches this server: a page that
 * answers 200 through it. ngrok answers an offline endpoint with a 404 of
 * its own, which is why a page and not the webhook route is asked.
 */
export async function webhooksReachable(): Promise<{ ok: boolean; why: string }> {
  const url = publicUrl();
  if (!url) return { ok: false, why: "E2E_PUBLIC_URL is not set (the tunnel the providers' webhooks reach)" };
  try {
    const response = await fetch(`${url}/pricing`, { headers: { "ngrok-skip-browser-warning": "1" }, signal: AbortSignal.timeout(15_000), redirect: "manual" });
    return response.status === 200 ? { ok: true, why: `${url} answers` } : { ok: false, why: `${url}/pricing answered HTTP ${response.status}: is the tunnel up and pointed at this server?` };
  } catch (error) {
    return { ok: false, why: `${url} is not reachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
