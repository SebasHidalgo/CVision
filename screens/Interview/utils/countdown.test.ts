import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_FINAL_SECONDS,
  COUNTDOWN_WARNING_SECONDS,
  countdownNotice,
  countdownPhase,
  formatClock,
  remainingSeconds,
} from "./countdown";

describe("countdownPhase", () => {
  it("is normal above the warning threshold and warns from the threshold down", () => {
    expect(countdownPhase(COUNTDOWN_WARNING_SECONDS + 1)).toBe("normal");
    expect(countdownPhase(COUNTDOWN_WARNING_SECONDS)).toBe("warning");
    expect(countdownPhase(COUNTDOWN_FINAL_SECONDS + 1)).toBe("warning");
  });

  it("is final from the last ten seconds down to zero", () => {
    expect(countdownPhase(COUNTDOWN_FINAL_SECONDS)).toBe("final");
    expect(countdownPhase(1)).toBe("final");
    expect(countdownPhase(0)).toBe("final");
  });
});

describe("remainingSeconds", () => {
  it("counts down from the limit and never goes negative", () => {
    const connectedAt = 1_000_000;
    expect(remainingSeconds(720, connectedAt, connectedAt)).toBe(720);
    expect(remainingSeconds(720, connectedAt, connectedAt + 61_500)).toBe(659);
    expect(remainingSeconds(720, connectedAt, connectedAt + 800_000)).toBe(0);
  });
});

describe("formatClock", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatClock(720)).toBe("12:00");
    expect(formatClock(59)).toBe("0:59");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("countdownNotice", () => {
  it("says nothing while time is normal", () => {
    expect(countdownNotice("normal", "en")).toBeNull();
    expect(countdownNotice("normal", "es")).toBeNull();
  });

  it("warns in the session's language, so a Spanish session is warned in Spanish", () => {
    expect(countdownNotice("warning", "en")).toMatch(/one minute/i);
    expect(countdownNotice("final", "en")).toMatch(/wrapping up/i);
    expect(countdownNotice("warning", "es")).toMatch(/un minuto/i);
    expect(countdownNotice("final", "es")).toMatch(/cerrando/i);
  });
});
