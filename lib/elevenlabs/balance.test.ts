import { describe, expect, it } from "vitest";
import { MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/interviewLimits";
import {
  decideVoiceCapacity,
  describeVoiceBalance,
  readBalanceFloor,
  VOICE_BALANCE_FLOOR_CREDITS,
  VOICE_BALANCE_MARGIN,
  VOICE_CREDITS_PER_MINUTE,
  type VoiceBalance,
} from "./balance";

const balance = (overrides: Partial<VoiceBalance> = {}): VoiceBalance => ({
  tier: "creator",
  status: "active",
  creditsUsed: 100_000,
  creditsLimit: 121_000,
  creditsRemaining: 21_000,
  extension: 0,
  resetsAt: new Date("2026-11-01T00:00:00Z"),
  ...overrides,
});

describe("the balance floor", () => {
  it("is one full interview at the measured rate plus the margin: 12,000 credits", () => {
    expect(VOICE_CREDITS_PER_MINUTE).toBe(800);
    expect(VOICE_BALANCE_FLOOR_CREDITS).toBe(Math.ceil((MAX_INTERVIEW_DURATION_SECONDS / 60) * 800 * VOICE_BALANCE_MARGIN));
    expect(VOICE_BALANCE_FLOOR_CREDITS).toBe(12_000);
  });

  it("can be overridden by a whole number in the environment, 0 included; anything else keeps the default", () => {
    expect(readBalanceFloor({})).toBe(12_000);
    expect(readBalanceFloor({ ELEVENLABS_BALANCE_FLOOR_CREDITS: "5000" })).toBe(5_000);
    expect(readBalanceFloor({ ELEVENLABS_BALANCE_FLOOR_CREDITS: "0" })).toBe(0);
    expect(readBalanceFloor({ ELEVENLABS_BALANCE_FLOOR_CREDITS: " 7000 " })).toBe(7_000);
    expect(readBalanceFloor({ ELEVENLABS_BALANCE_FLOOR_CREDITS: "lots" })).toBe(12_000);
    expect(readBalanceFloor({ ELEVENLABS_BALANCE_FLOOR_CREDITS: "-1" })).toBe(12_000);
    expect(readBalanceFloor({ ELEVENLABS_BALANCE_FLOOR_CREDITS: "1.5" })).toBe(12_000);
  });
});

describe("decideVoiceCapacity", () => {
  it("allows a start when the credits left clear the floor, and refuses below it", () => {
    expect(decideVoiceCapacity(balance({ creditsRemaining: 12_000 }), 12_000)).toMatchObject({ ok: true, available: 12_000 });
    expect(decideVoiceCapacity(balance({ creditsRemaining: 11_999 }), 12_000)).toMatchObject({ ok: false, available: 11_999, remaining: 11_999, floor: 12_000 });
    expect(decideVoiceCapacity(balance({ creditsRemaining: 0 }), 12_000).ok).toBe(false);
  });

  it("counts a usage-based extension as reachable credits, unlimited included", () => {
    expect(decideVoiceCapacity(balance({ creditsRemaining: 100, extension: 20_000 }), 12_000)).toMatchObject({ ok: true, available: 20_100 });
    expect(decideVoiceCapacity(balance({ creditsRemaining: 0, extension: "unlimited" }), 12_000)).toMatchObject({ ok: true, available: Number.POSITIVE_INFINITY });
    expect(decideVoiceCapacity(balance({ creditsRemaining: 100, extension: -5 }), 12_000)).toMatchObject({ ok: false, available: 100 });
  });

  it("is off at a floor of zero", () => {
    expect(decideVoiceCapacity(balance({ creditsRemaining: 0 }), 0)).toMatchObject({ ok: true, floor: 0 });
  });
});

describe("describeVoiceBalance", () => {
  it("says the plan, the credits and the extension in one line", () => {
    expect(describeVoiceBalance(balance())).toBe("creator plan (active): 21000 of 121000 credits left, no usage-based extension, resets 2026-11-01");
    expect(describeVoiceBalance(balance({ extension: "unlimited", resetsAt: null }))).toBe("creator plan (active): 21000 of 121000 credits left, unlimited usage-based extension");
    expect(describeVoiceBalance(balance({ extension: 5_000 }))).toContain("5000 credits of usage-based extension");
  });
});
