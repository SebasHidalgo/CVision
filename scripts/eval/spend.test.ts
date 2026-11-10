import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costOf } from "./pricing";
import {
  expectedTokens,
  failureFrom,
  phaseOf,
  planTier,
  retryAfter,
  routeRequest,
  SpendGuard,
  spentOnDay,
  usageFrom,
  type SpendRow,
} from "./spend";
import { requireComparable, type BaseRunRecord } from "./shared";

const row = (over: Partial<SpendRow>): SpendRow => ({
  at: "2026-11-10T01:00:00.000Z",
  day: "2026-11-10",
  command: "run",
  label: "m8g-x",
  phase: "m8g",
  runId: "r1",
  fixture: "f",
  tier: "flex",
  model: "gemini-3.5-flash-lite",
  input: 0,
  output: 0,
  costUsd: 0,
  source: "live",
  ...over,
});

afterEach(() => vi.restoreAllMocks());

const exits = () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
};

describe("prices", () => {
  it("prices a call from its tokens at each tier", () => {
    expect(costOf("gemini-3.5-flash-lite", "standard", 1_000_000, 1_000_000)).toBeCloseTo(2.8);
    expect(costOf("gemini-3.5-flash-lite", "flex", 1_000_000, 1_000_000)).toBeCloseTo(1.4);
    expect(costOf("gemini-3.5-flash-lite", "free", 1_000_000, 1_000_000)).toBe(0);
  });

  it("prices an unknown model at the dearest known rate, never at zero", () => {
    expect(costOf("some-new-model", "standard", 0, 1_000_000)).toBeCloseTo(2.5);
  });
});

describe("phaseOf", () => {
  it("reads the phase from the label, a canary included", () => {
    expect(phaseOf("m8g-new-s7", {})).toBe("m8g");
    expect(phaseOf("canary-m8f-final-s7", {})).toBe("m8f");
    expect(phaseOf("after-swap", {})).toBe("other");
    expect(phaseOf("ctl-s7", { EVAL_PHASE: "m8g" })).toBe("m8g");
  });
});

describe("planTier", () => {
  const env = { GOOGLE_GENERATIVE_AI_API_KEY_FREE: "k" };

  it("sends invented data to the free key and real data to paid Flex", () => {
    expect(planTier("synthetic", undefined, env).tier).toBe("free");
    expect(planTier("local", undefined, env).tier).toBe("flex");
    expect(planTier("local", undefined, { ...env, EVAL_PAID_TIER: "standard" }).tier).toBe("standard");
  });

  it("falls back to the paid key without a free one, and says so", () => {
    const plan = planTier("synthetic", undefined, {});
    expect(plan.tier).toBe("flex");
    expect(plan.note).toMatch(/not set/);
  });

  it("never sends real data to the free tier", () => {
    exits();
    expect(() => planTier("local", "free", env)).toThrow(/exit 1/);
  });
});

describe("routeRequest", () => {
  const init = { method: "POST", headers: { "x-goog-api-key": "paid" }, body: JSON.stringify({ contents: [] }) };

  it("leaves a standard request untouched", () => {
    expect(routeRequest(init, "standard", "free")).toBe(init);
  });

  it("asks for Flex in the body", () => {
    const routed = routeRequest(init, "flex", undefined);
    expect(JSON.parse(String(routed?.body))).toEqual({ contents: [], serviceTier: "flex" });
  });

  it("swaps in the free key and keeps the body", () => {
    const routed = routeRequest(init, "free", "free-key");
    expect(new Headers(routed?.headers).get("x-goog-api-key")).toBe("free-key");
    expect(routed?.body).toBe(init.body);
  });
});

describe("usage and failures", () => {
  it("counts thinking as output and reads the served tier", () => {
    expect(usageFrom({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2, serviceTier: "flex" } })).toEqual({
      input: 10,
      output: 7,
      served: "flex",
    });
  });

  it("reads the wait and the daily quota from a 429", () => {
    const body = {
      error: {
        status: "RESOURCE_EXHAUSTED",
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" },
        ],
      },
    };
    expect(failureFrom(429, body)).toEqual({ status: 429, retryDelayMs: 34_000, perDay: true });
  });

  it("retries capacity errors with backoff, never a daily quota, at most three times", () => {
    expect(retryAfter([], 1).retry).toBe(false);
    expect(retryAfter([{ status: 503, retryDelayMs: null, perDay: false }], 1)).toEqual({ retry: true, waitMs: 15_000, perDay: false });
    expect(retryAfter([{ status: 429, retryDelayMs: 40_000, perDay: false }], 2).waitMs).toBe(40_000);
    expect(retryAfter([{ status: 503, retryDelayMs: null, perDay: false }], 3).retry).toBe(false);
    expect(retryAfter([{ status: 429, retryDelayMs: null, perDay: true }], 1)).toMatchObject({ retry: false, perDay: true });
    expect(retryAfter([{ status: 400, retryDelayMs: null, perDay: false }], 1).retry).toBe(false);
  });
});

describe("caps", () => {
  const budget = { perRunUsd: 0.5, perDayUsd: 0.75 };
  const guard = (rows: SpendRow[]) => new SpendGuard(budget, "r1", () => rows, () => "2026-11-10");

  it("lets work start under both caps", () => {
    expect(guard([row({ costUsd: 0.1 })]).refuse(0.2)).toBeNull();
  });

  it("refuses work that would cross the run cap", () => {
    expect(guard([row({ costUsd: 0.45 })]).refuse(0.06)).toMatch(/run cap/);
  });

  it("counts every run of the day, not only this one, and never backfilled history", () => {
    const rows = [row({ runId: "other", costUsd: 0.7 }), row({ runId: "old", source: "backfill", costUsd: 5 }), row({ runId: "yesterday", day: "2026-11-09", costUsd: 3 })];
    expect(spentOnDay(rows, "2026-11-10")).toBeCloseTo(0.7);
    expect(guard(rows).refuse(0.06)).toMatch(/day cap/);
  });

  it("never refuses a free call", () => {
    expect(guard([row({ runId: "other", costUsd: 0.75 })]).refuse(0)).toBeNull();
  });

  it("estimates from the largest past run of the fixture", () => {
    const rows = [
      row({ runId: "a", input: 100, output: 50 }),
      row({ runId: "a", input: 10, output: 10 }),
      row({ runId: "b", input: 90, output: 70 }),
    ];
    expect(expectedTokens(rows, "f", "analysis")).toEqual({ input: 110, output: 70 });
    expect(expectedTokens(rows, "g", "analysis")).toEqual({ input: 8_000, output: 5_000 });
  });
});

describe("the comparison gate", () => {
  const engine = { provider: "google", model: "m", modelVersion: null, apiModelVersion: "v", temperature: "0", seed: "7" };
  const record = (tier?: string): BaseRunRecord => ({
    fixture: "f",
    source: "synthetic",
    label: "x",
    provider: "google",
    model: "m",
    engine: { ...engine, ...(tier ? { tier } : {}) },
    generatedAt: "2026-11-10T01:00:00.000Z",
    durationMs: 1,
    tokens: { input: 1, output: 1 },
    result: { ok: true },
  });

  it("refuses two runs whose tiers differ for a fixture", () => {
    exits();
    expect(() => requireComparable([["a", new Map([["f", record("free")]])], ["b", new Map([["f", record()]])]], false)).toThrow(/exit 1/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("tier differs for f"));
  });

  it("accepts the same tier on both sides", () => {
    expect(() => requireComparable([["a", new Map([["f", record("flex")]])], ["b", new Map([["f", record("flex")]])]], false)).not.toThrow();
  });
});

describe("the eval fetch", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "spend-"));
    vi.stubEnv("EVAL_SPEND_LEDGER", path.join(dir, "spend.jsonl"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    rmSync(dir, { recursive: true, force: true });
  });

  it("asks for Flex, then writes one ledger row priced at the tier served", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(String(init.body));
      return new Response(JSON.stringify({ usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 2000, serviceTier: "flex" } }), { status: 200 });
    });
    const spend = await import("./spend");
    spend.installEvalFetch();
    spend.beginCalls({ command: "run", label: "m8g-t", runId: "r", fixture: "f", tier: "flex" });
    await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", { method: "POST", body: "{}" });
    const calls = spend.endCalls();

    expect(JSON.parse(seen[0])).toEqual({ serviceTier: "flex" });
    expect(calls.served).toEqual(["flex"]);
    const [written] = readFileSync(path.join(dir, "spend.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as SpendRow);
    expect(written).toMatchObject({ fixture: "f", tier: "flex", input: 1000, output: 2000, phase: "m8g", source: "live" });
    expect(written.costUsd).toBeCloseTo((1000 * 0.15 + 2000 * 1.25) / 1_000_000);
  });

  it("passes every other request through unrouted", async () => {
    const fake = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fake);
    const spend = await import("./spend");
    spend.installEvalFetch();
    await fetch("https://generativelanguage.googleapis.com/v1beta/models/x?key=k");
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
