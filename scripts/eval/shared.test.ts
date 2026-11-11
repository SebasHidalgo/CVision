import { afterEach, describe, expect, it, vi } from "vitest";
import { requireComparable, type BaseRunRecord } from "./shared";

const engine = { provider: "google", model: "gemini-3.5-flash-lite", modelVersion: null, apiModelVersion: "v", temperature: "0", seed: "7" };
const run = (...times: string[]) =>
  new Map<string, BaseRunRecord>(
    times.map((generatedAt, i) => [
      `f${i}`,
      { fixture: `f${i}`, source: "synthetic", label: "x", provider: "google", model: "m", engine, generatedAt, durationMs: 1, tokens: { input: 1, output: 1 }, result: { ok: true } },
    ]),
  );

afterEach(() => vi.restoreAllMocks());

describe("requireComparable across UTC midnight", () => {
  const exits = () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
  };

  it("refuses runs whose prompts carried two different dates, unless forced", () => {
    exits();
    const a = run("2026-11-03T23:50:00Z");
    const b = run("2026-11-04T00:10:00Z");

    expect(() => requireComparable([["a", a], ["b", b]], false, { datedPrompt: true })).toThrow("exit 1");
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain("both sides of UTC midnight (2026-11-03, 2026-11-04)");
    expect(() => requireComparable([["a", a], ["b", b]], true, { datedPrompt: true })).not.toThrow();
  });

  it("accepts the same runs when the prompt carries no date, and same-day runs either way", () => {
    exits();
    expect(() => requireComparable([["a", run("2026-11-03T23:50:00Z")], ["b", run("2026-11-04T00:10:00Z")]], false)).not.toThrow();
    expect(() => requireComparable([["a", run("2026-11-04T00:10:00Z")], ["b", run("2026-11-04T05:00:00Z")]], false, { datedPrompt: true })).not.toThrow();
  });
});
