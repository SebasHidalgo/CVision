import "server-only";

/**
 * Which Clerk accounts still exist, read from Clerk's Backend API with the
 * secret key over plain fetch (no SDK: this runs in a cron route and in a
 * script, and only needs two reads). Built for a caller that deletes on a
 * "gone" answer, so every answer that is not certain throws
 * `ClerkLookupError`: a 5xx, a 401/403, a network failure or timeout, a
 * body of the wrong shape, a 429 that outlasts its retries, a list that
 * names an account nobody asked about. Only a 404 that Clerk itself labels
 * `resource_not_found`, for that one id, reads as gone.
 */

const API = "https://api.clerk.com/v1";
// The Backend API version the installed @clerk/backend speaks; pinned so the response shape cannot move under us.
const API_VERSION = "2025-11-10";
const TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_WAIT_SECONDS = 30;

/** The most ids Clerk's user list filters by in one call (`user_id`, documented up to 100). */
export const CLERK_LOOKUP_BATCH = 100;

export class ClerkLookupError extends Error {
  override name = "ClerkLookupError";
}

export type ClerkUserLookup = {
  /** Of these ids (at most CLERK_LOOKUP_BATCH, distinct), the ones Clerk lists. */
  listExisting(ids: string[]): Promise<Set<string>>;
  /** True only for a 404 that Clerk labels `resource_not_found`; false for the account itself; throws otherwise. */
  isGone(id: string): Promise<boolean>;
};

type Dependencies = {
  secretKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Seconds to wait from a 429's Retry-After (seconds or an HTTP date); null when absent or unreadable. */
function retryAfterSeconds(headers: Headers, now = Date.now()): number | null {
  const value = headers.get("retry-after")?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

function errorCodes(body: unknown): string[] {
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => (e as { code?: unknown })?.code).filter((code): code is string => typeof code === "string");
}

export function clerkUserLookup({ secretKey, fetch: fetchImpl = fetch, sleep = defaultSleep }: Dependencies): ClerkUserLookup {
  if (!secretKey.trim()) throw new ClerkLookupError("CLERK_SECRET_KEY is not set");

  async function get(url: URL, what: string): Promise<{ status: number; body: unknown }> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { authorization: `Bearer ${secretKey}`, "clerk-api-version": API_VERSION, accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new ClerkLookupError(`${what}: no answer (${error instanceof Error ? error.name : "network"})`);
      }
      if (response.status === 429) {
        const wait = retryAfterSeconds(response.headers) ?? 2 ** attempt;
        if (attempt >= MAX_RATE_LIMIT_RETRIES) throw new ClerkLookupError(`${what}: still rate limited after ${attempt} retries`);
        if (wait > MAX_RETRY_WAIT_SECONDS) throw new ClerkLookupError(`${what}: rate limited for ${wait} s`);
        await sleep(wait * 1000);
        continue;
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status, body };
    }
  }

  return {
    async listExisting(ids) {
      if (ids.length === 0) return new Set();
      if (ids.length > CLERK_LOOKUP_BATCH || new Set(ids).size !== ids.length) {
        throw new ClerkLookupError(`list: ${ids.length} ids; at most ${CLERK_LOOKUP_BATCH}, all distinct`);
      }
      const url = new URL(`${API}/users`);
      for (const id of ids) url.searchParams.append("user_id", id);
      url.searchParams.set("limit", String(CLERK_LOOKUP_BATCH));
      const { status, body } = await get(url, "list");
      if (status !== 200) throw new ClerkLookupError(`list: HTTP ${status} ${errorCodes(body).join(",")}`.trim());

      const users = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
      if (!Array.isArray(users)) throw new ClerkLookupError("list: the body is not a list of users");
      const asked = new Set(ids);
      const found = new Set<string>();
      for (const user of users) {
        const id = (user as { id?: unknown } | null)?.id;
        if (typeof id !== "string") throw new ClerkLookupError("list: a user without an id");
        // A filter Clerk ignored would list other accounts: never read absence from such a list.
        if (!asked.has(id)) throw new ClerkLookupError("list: an account that was not asked about");
        found.add(id);
      }
      return found;
    },

    async isGone(id) {
      const { status, body } = await get(new URL(`${API}/users/${encodeURIComponent(id)}`), "user");
      if (status === 200 && (body as { id?: unknown } | null)?.id === id) return false;
      if (status === 404 && errorCodes(body).includes("resource_not_found")) return true;
      throw new ClerkLookupError(`user: HTTP ${status} ${errorCodes(body).join(",")}`.trim());
    },
  };
}
