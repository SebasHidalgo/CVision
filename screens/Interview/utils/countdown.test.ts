import { describe, expect, it } from "vitest";
import { tFor } from "@/lib/i18n/testing";
import {
  COUNTDOWN_FINAL_SECONDS,
  COUNTDOWN_WARNING_SECONDS,
  countdownNoticeKey,
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

describe("countdownNoticeKey", () => {
  it("says nothing while time is normal", () => {
    expect(countdownNoticeKey("normal")).toBeNull();
  });

  it("warns at one minute and again at the end, in each interface language", () => {
    const en = tFor("interview", "en");
    const es = tFor("interview", "es");
    const warning = countdownNoticeKey("warning")!;
    const final = countdownNoticeKey("final")!;
    expect(en(warning)).toMatch(/one minute/i);
    expect(en(final)).toMatch(/wrapping up/i);
    expect(es(warning)).toMatch(/un minuto/i);
    expect(es(final)).toMatch(/cerrando/i);
  });
});
