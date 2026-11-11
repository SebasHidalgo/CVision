import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeProvider, reply } from "./client.stub";
import { fixFor, runAiDoctor } from "./doctor";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("runAiDoctor", () => {
  it("reports OK with the version the response carries", async () => {
    installFakeProvider(() => reply.json({ ok: true }));

    const report = await runAiDoctor();

    expect(report.outcome).toBe("ok");
    expect(report.ping).toMatchObject({ provider: "google", model: "gemini-3.5-flash-lite" });
    expect(fixFor(report.outcome)).toBe("");
  });

  it.each([
    [402, "billing-exhausted"],
    [429, "rate-limited"],
    [401, "misconfigured"],
    [503, "unavailable"],
  ] as const)("names HTTP %d as %s, with the fix", async (status, outcome) => {
    installFakeProvider(() => reply.error(status));

    const report = await runAiDoctor();

    expect(report.outcome).toBe(outcome);
    expect(report.ping).toBeNull();
    expect(fixFor(report.outcome)).not.toBe("");
  });
});
