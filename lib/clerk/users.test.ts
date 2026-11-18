import { describe, expect, it, vi } from "vitest";
import { CLERK_LOOKUP_BATCH, ClerkLookupError, clerkUserLookup } from "./users";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/** A fetch that answers from a script, one reply per call, and records the URLs it was asked. */
function scripted(...replies: Reply[]) {
  const urls: URL[] = [];
  const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    urls.push(new URL(String(input)));
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk_test_secret");
    const reply = replies.shift();
    if (!reply) throw new Error("no scripted reply left");
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? "not json" : JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  });
  const sleep = vi.fn(async () => {});
  return { lookup: clerkUserLookup({ secretKey: "sk_test_secret", fetch: fetch as unknown as typeof globalThis.fetch, sleep }), fetch, sleep, urls };
}

const NOT_FOUND = { errors: [{ code: "resource_not_found", message: "not found" }] };

describe("listExisting", () => {
  it("asks for exactly these ids in one call and returns the ones Clerk lists", async () => {
    const { lookup, urls } = scripted({ status: 200, body: [{ id: "user_a" }, { id: "user_c" }] });
    expect(await lookup.listExisting(["user_a", "user_b", "user_c"])).toEqual(new Set(["user_a", "user_c"]));
    expect(urls[0].pathname).toBe("/v1/users");
    expect(urls[0].searchParams.getAll("user_id")).toEqual(["user_a", "user_b", "user_c"]);
    expect(urls[0].searchParams.get("limit")).toBe(String(CLERK_LOOKUP_BATCH));
  });

  it("reads the paginated shape too", async () => {
    const { lookup } = scripted({ status: 200, body: { data: [{ id: "user_a" }], total_count: 1 } });
    expect(await lookup.listExisting(["user_a", "user_b"])).toEqual(new Set(["user_a"]));
  });

  it("refuses a list that names an account nobody asked about: the filter was ignored", async () => {
    const { lookup } = scripted({ status: 200, body: [{ id: "user_a" }, { id: "user_zz" }] });
    await expect(lookup.listExisting(["user_a", "user_b"])).rejects.toThrow(ClerkLookupError);
  });

  it.each([
    ["a 500", { status: 500, body: { errors: [{ code: "internal" }] } }],
    ["a 401", { status: 401, body: { errors: [{ code: "authentication_invalid" }] } }],
    ["a 403", { status: 403, body: {} }],
    ["a body that is not JSON", { status: 200 }],
    ["a body that is not a list", { status: 200, body: { users: [] } }],
    ["a user without an id", { status: 200, body: [{ name: "x" }] }],
    ["a network failure", new TypeError("fetch failed")],
  ] as const)("throws on %s", async (_label, reply) => {
    const { lookup } = scripted(reply as Reply);
    await expect(lookup.listExisting(["user_a"])).rejects.toThrow(ClerkLookupError);
  });

  it("waits out a 429 by its Retry-After and tries again", async () => {
    const { lookup, sleep } = scripted({ status: 429, headers: { "retry-after": "3" } }, { status: 200, body: [{ id: "user_a" }] });
    expect(await lookup.listExisting(["user_a"])).toEqual(new Set(["user_a"]));
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("gives up after three retries, or on a Retry-After past 30 s", async () => {
    const limited = { status: 429, headers: { "retry-after": "1" } };
    const many = scripted(limited, limited, limited, limited);
    await expect(many.lookup.listExisting(["user_a"])).rejects.toThrow(/still rate limited after 3 retries/);
    expect(many.fetch).toHaveBeenCalledTimes(4);

    const long = scripted({ status: 429, headers: { "retry-after": "120" } });
    await expect(long.lookup.listExisting(["user_a"])).rejects.toThrow(/rate limited for 120 s/);
    expect(long.sleep).not.toHaveBeenCalled();
  });

  it("refuses more ids than one call filters by, or repeated ids, without calling", async () => {
    const { lookup, fetch } = scripted();
    const ids = Array.from({ length: CLERK_LOOKUP_BATCH + 1 }, (_, i) => `user_${i}`);
    await expect(lookup.listExisting(ids)).rejects.toThrow(ClerkLookupError);
    await expect(lookup.listExisting(["user_a", "user_a"])).rejects.toThrow(ClerkLookupError);
    expect(await lookup.listExisting([])).toEqual(new Set());
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("isGone", () => {
  it("is true only for Clerk's own not-found on that id", async () => {
    const { lookup, urls } = scripted({ status: 404, body: NOT_FOUND });
    expect(await lookup.isGone("user_a")).toBe(true);
    expect(urls[0].pathname).toBe("/v1/users/user_a");
  });

  it("is false for the account itself", async () => {
    const { lookup } = scripted({ status: 200, body: { id: "user_a" } });
    expect(await lookup.isGone("user_a")).toBe(false);
  });

  it.each([
    ["a 404 that is not Clerk's resource_not_found", { status: 404, body: { errors: [{ code: "other" }] } }],
    ["a 404 without a body", { status: 404 }],
    ["a 200 for another account", { status: 200, body: { id: "user_b" } }],
    ["a 502", { status: 502, body: {} }],
    ["a 401", { status: 401, body: {} }],
  ] as const)("throws on %s", async (_label, reply) => {
    const { lookup } = scripted(reply as Reply);
    await expect(lookup.isGone("user_a")).rejects.toThrow(ClerkLookupError);
  });
});

it("refuses to start without a secret key", () => {
  expect(() => clerkUserLookup({ secretKey: " " })).toThrow(/CLERK_SECRET_KEY is not set/);
});
