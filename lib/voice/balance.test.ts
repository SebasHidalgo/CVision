import { describe, expect, it } from "vitest";
import { INTERVIEW_GRACE_SECONDS, MAX_CALL_SECONDS, MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/interviewLimits";
import {
  burstInterviewCredits,
  decideVoiceCapacity,
  describeVoiceBalance,
  interviewCredits,
  interviewsCovered,
  readBalanceFloor,
  readCreditsPerMinute,
  voiceBalanceFloor,
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
  it("is one full interview, its grace included, at the measured rate plus the margin: 7,329 credits on Starter", () => {
    // Measured with voice:cost on 2026-11-12: 398 for the call and 53 for the LLM.
    expect(VOICE_CREDITS_PER_MINUTE).toBe(451);
    expect(VOICE_BALANCE_MARGIN).toBe(1.25);
    // The platform cuts a call at the paid length plus the grace: that is what a start can cost.
    expect(MAX_CALL_SECONDS).toBe(MAX_INTERVIEW_DURATION_SECONDS + INTERVIEW_GRACE_SECONDS);
    expect(VOICE_BALANCE_FLOOR_CREDITS).toBe(Math.ceil((MAX_CALL_SECONDS / 60) * 451 * 1.25));
    expect(VOICE_BALANCE_FLOOR_CREDITS).toBe(7_329);
    // The floor leaves room for more than one interview's cost, and less than two.
    expect(VOICE_BALANCE_FLOOR_CREDITS).toBeGreaterThan(interviewCredits(MAX_INTERVIEW_DURATION_SECONDS, {}));
    expect(VOICE_BALANCE_FLOOR_CREDITS).toBeLessThan(2 * interviewCredits(MAX_INTERVIEW_DURATION_SECONDS, {}));
  });

  it("takes the rate of another plan from the environment, when it is a positive whole number", () => {
    expect(readCreditsPerMinute({})).toBe(451);
    expect(readCreditsPerMinute({ ELEVENLABS_CREDITS_PER_MINUTE: " 790 " })).toBe(790);
    for (const bad of ["", "0", "-3", "4.5", "cheap"]) expect(readCreditsPerMinute({ ELEVENLABS_CREDITS_PER_MINUTE: bad })).toBe(451);
    expect(readBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, { ELEVENLABS_CREDITS_PER_MINUTE: "790" })).toBe(12_838);
    // The explicit floor still wins over the rate.
    expect(readBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, { ELEVENLABS_CREDITS_PER_MINUTE: "790", ELEVENLABS_BALANCE_FLOOR_CREDITS: "3000" })).toBe(3_000);
  });

  it("says what an interview costs, what it costs at the burst rate, and how many a balance pays for", () => {
    // The worst case: the paid length and the whole grace. The grace adds 451 credits to either.
    expect(interviewCredits(12 * 60, {})).toBe(5_863);
    expect(interviewCredits(5 * 60, {})).toBe(2_706);
    expect(interviewCredits(5 * 60, {}) - Math.ceil(5 * 451)).toBe(451);
    // Bursting doubles the rate; the floor is not sized on it.
    expect(burstInterviewCredits(12 * 60, {})).toBe(11_726);
    expect(VOICE_BALANCE_FLOOR_CREDITS).toBeLessThan(burstInterviewCredits(12 * 60, {}));
    // Starter's 30,000 credits: five full interviews, or eleven trials.
    expect(interviewsCovered(30_000, 12 * 60, {})).toBe(5);
    expect(interviewsCovered(30_000, 5 * 60, {})).toBe(11);
    expect(interviewsCovered(5_862, 12 * 60, {})).toBe(0);
    expect(interviewsCovered(Number.POSITIVE_INFINITY, 12 * 60, {})).toBe(Number.POSITIVE_INFINITY);
  });

  it("can be overridden by a whole number in the environment, 0 included; anything else keeps the default", () => {
    expect(readBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, {})).toBe(7_329);
    expect(readBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, { ELEVENLABS_BALANCE_FLOOR_CREDITS: "5000" })).toBe(5_000);
    expect(readBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, { ELEVENLABS_BALANCE_FLOOR_CREDITS: "0" })).toBe(0);
    expect(readBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, { ELEVENLABS_BALANCE_FLOOR_CREDITS: " 7000 " })).toBe(7_000);
    expect(readBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, { ELEVENLABS_BALANCE_FLOOR_CREDITS: "lots" })).toBe(7_329);
    expect(readBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, { ELEVENLABS_BALANCE_FLOOR_CREDITS: "-1" })).toBe(7_329);
    expect(readBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, { ELEVENLABS_BALANCE_FLOOR_CREDITS: "1.5" })).toBe(7_329);
  });
});

describe("the floor per agent", () => {
  it("is the agent's hard limit (paid length plus grace) at the measured rate plus the margin: 3,383 for the trial", () => {
    expect(voiceBalanceFloor(5 * 60, {})).toBe(Math.ceil(((5 * 60 + INTERVIEW_GRACE_SECONDS) / 60) * 451 * 1.25));
    expect(voiceBalanceFloor(5 * 60, {})).toBe(3_383);
    expect(readBalanceFloor(5 * 60, {})).toBe(3_383);
    expect(readBalanceFloor(5 * 60, { ELEVENLABS_BALANCE_FLOOR_CREDITS: "7000" })).toBe(7_000);
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
