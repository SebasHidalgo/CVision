import { beforeEach, describe, expect, it, vi } from "vitest";
import { readVoiceBalance, type VoiceBalanceRead } from "./client";
import { assertVoiceCapacity, resetVoiceHealth, VOICE_BALANCE_CACHE_MS } from "./health";

vi.mock("./client", () => ({ readVoiceBalance: vi.fn() }));

const NOW = Date.parse("2026-10-23T12:00:00Z");

const read = (creditsRemaining: number, overrides: Record<string, unknown> = {}): VoiceBalanceRead => ({
  kind: "balance",
  balance: {
    tier: "free",
    status: "free",
    creditsUsed: 10_000 - creditsRemaining,
    creditsLimit: 10_000,
    creditsRemaining,
    extension: 0,
    resetsAt: new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  resetVoiceHealth();
  vi.stubEnv("ELEVENLABS_BALANCE_FLOOR_CREDITS", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("assertVoiceCapacity", () => {
  it("lets a start through when the balance clears the floor", async () => {
    vi.mocked(readVoiceBalance).mockResolvedValue(read(50_000));
    await expect(assertVoiceCapacity(NOW)).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("refuses a start below the floor as VOICE_UNAVAILABLE, with one error line for the owner per read, not per start", async () => {
    vi.mocked(readVoiceBalance).mockResolvedValue(read(900));

    await expect(assertVoiceCapacity(NOW)).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
    await expect(assertVoiceCapacity(NOW + 1_000)).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toMatch(/REFUSING voice sessions: free plan \(free\): 900 of 10000 credits left.*floor 12000 credits/);
  });

  it("reads the balance once a minute, not on every start", async () => {
    vi.mocked(readVoiceBalance).mockResolvedValue(read(50_000));

    await assertVoiceCapacity(NOW);
    await assertVoiceCapacity(NOW + VOICE_BALANCE_CACHE_MS - 1);
    expect(readVoiceBalance).toHaveBeenCalledTimes(1);

    await assertVoiceCapacity(NOW + VOICE_BALANCE_CACHE_MS);
    expect(readVoiceBalance).toHaveBeenCalledTimes(2);
  });

  it("warns once and never blocks when the key cannot read the balance", async () => {
    vi.mocked(readVoiceBalance).mockResolvedValue({ kind: "no-permission", permission: "user_read" });

    await expect(assertVoiceCapacity(NOW)).resolves.toBeUndefined();
    await expect(assertVoiceCapacity(NOW + VOICE_BALANCE_CACHE_MS + 1)).resolves.toBeUndefined();

    expect(readVoiceBalance).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.warn).mock.calls[0][0])).toContain("lacks user_read");
  });

  it("does not block, and does not cache, when the platform fails to answer", async () => {
    vi.mocked(readVoiceBalance).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(read(900));

    await expect(assertVoiceCapacity(NOW)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("balance not read"), expect.anything());

    // The next start reads again, and this time the balance is known to be short.
    await expect(assertVoiceCapacity(NOW + 1)).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
    expect(readVoiceBalance).toHaveBeenCalledTimes(2);
  });

  it("counts a usage-based extension, and is off at a floor of zero", async () => {
    vi.mocked(readVoiceBalance).mockResolvedValue(read(0, { extension: "unlimited" }));
    await expect(assertVoiceCapacity(NOW)).resolves.toBeUndefined();

    resetVoiceHealth();
    vi.stubEnv("ELEVENLABS_BALANCE_FLOOR_CREDITS", "0");
    vi.mocked(readVoiceBalance).mockResolvedValue(read(0));
    await expect(assertVoiceCapacity(NOW)).resolves.toBeUndefined();
    expect(readVoiceBalance).toHaveBeenCalledTimes(1);
  });
});
