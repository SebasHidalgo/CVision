import { existsSync, readFileSync } from "node:fs";
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
export function assertSandbox({ server = true }: { server?: boolean } = {}): void {
  if (server) assertLedgerServer();
  if (process.env.PADDLE_ENV !== "sandbox") throw new Error(`PADDLE_ENV is ${process.env.PADDLE_ENV ?? "unset"}; the e2e suite runs only against the sandbox`);
  if (!required("PADDLE_API_KEY").startsWith("pdl_sdbx_")) throw new Error("PADDLE_API_KEY is not a sandbox key");
  if (!required("CLERK_SECRET_KEY").startsWith("sk_test_")) throw new Error("CLERK_SECRET_KEY is not a development-instance key");
  if (!required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY").startsWith("pk_test_")) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a development-instance key");
}

/**
 * The app server must be the suite's own (e2e/server.mjs): Gemini on the free key, each call in the spend
 * ledger. A plain `npm run dev` left running would answer on the same port with the paid key, outside the
 * ledger, so the suite refuses it. E2E_NO_SERVER, with a server started some other way, skips the check.
 */
export function assertLedgerServer(): void {
  if (process.env.E2E_NO_SERVER) return;
  const marker = path.resolve(process.cwd(), "e2e", ".artifacts", "gemini-ledger.json");
  const fail = (why: string): never => {
    throw new Error(`the app server is not the suite's (${why}): stop any "npm run dev" on port 3000 and let Playwright start e2e/server.mjs, or run "npm run e2e:server"`);
  };
  if (!existsSync(marker)) fail("no Gemini ledger marker");
  const { pid } = JSON.parse(readFileSync(marker, "utf8")) as { pid: number };
  try {
    process.kill(pid, 0);
  } catch {
    fail(`the marker's process ${pid} is gone`);
  }
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
