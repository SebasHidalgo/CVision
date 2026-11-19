import * as crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refuseUnlessCron } from "./cronAuth";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = "cron-secret-0123456789abcdef";
const LOG = "[test] cron:";

const request = (authorization?: string) =>
  new Request("http://localhost/api/cron/x", { headers: authorization === undefined ? {} : { authorization } });

async function refusal(authorization?: string) {
  const response = refuseUnlessCron(request(authorization), LOG);
  return response ? { status: response.status, body: (await response.json()) as unknown } : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("refuseUnlessCron", () => {
  it("lets the bearer Vercel sends through", async () => {
    expect(await refusal(`Bearer ${SECRET}`)).toBeNull();
  });

  it("refuses a wrong secret, the secret without its scheme, a missing header, and secrets of another length", async () => {
    const unauthorized = { status: 401, body: { ok: false, code: "UNAUTHORIZED" } };
    expect(await refusal("Bearer cron-secret-0123456789abcdeX")).toEqual(unauthorized);
    expect(await refusal(SECRET)).toEqual(unauthorized);
    expect(await refusal()).toEqual(unauthorized);
    expect(await refusal("")).toEqual(unauthorized);
    expect(await refusal(`Bearer ${SECRET.slice(0, 5)}`)).toEqual(unauthorized);
    expect(await refusal(`Bearer ${SECRET}${SECRET}`)).toEqual(unauthorized);
  });

  it("compares in constant time on equal-length digests, whatever was sent", async () => {
    await refusal("Bearer x");
    await refusal(`Bearer ${SECRET}`);
    await refusal();
    const calls = vi.mocked(crypto.timingSafeEqual).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [a, b] of calls) {
      expect((a as Buffer).byteLength).toBe(32);
      expect((b as Buffer).byteLength).toBe(32);
    }
  });

  it("refuses everything, loudly, when CRON_SECRET is not configured (or only whitespace)", async () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("CRON_SECRET", value);
      expect(await refusal(`Bearer ${value}`)).toEqual({ status: 500, body: { ok: false, code: "CRON_MISCONFIGURED" } });
    }
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("CRON_SECRET is not set"));
    expect(crypto.timingSafeEqual).not.toHaveBeenCalled();
  });
});
