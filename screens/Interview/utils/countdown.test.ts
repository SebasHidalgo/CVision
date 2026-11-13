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

  it("says the last minute is still interview and then that seconds are left, in each interface language, and never that the call is ending", () => {
    const en = tFor("interview", "en");
    const es = tFor("interview", "es");
    const warning = countdownNoticeKey("warning")!;
    const final = countdownNoticeKey("final")!;
    expect(en(warning)).toBe("Last minute. The interviewer keeps asking until the time is up.");
    expect(en(final)).toBe("A few seconds left.");
    expect(es(warning)).toBe("Último minuto. El entrevistador sigue preguntando hasta que se cumpla el tiempo.");
    expect(es(final)).toBe("Quedan unos segundos.");
    // Before 0:00 nothing may tell the candidate to stop: the interview fills its time.
    for (const text of [en(warning), en(final), es(warning), es(final)]) {
      expect(text).not.toMatch(/wrapping up|finish the answer|cerrando|termina la respuesta|se acabó/i);
    }
  });

  it("has the copy for 0:00 and for a confirmed stop in both languages: the clock's label and the notice", () => {
    const en = tFor("interview", "en");
    const es = tFor("interview", "es");
    expect(en("room.clock.closing")).toBe("Time's up · closing…");
    expect(es("room.clock.closing")).toBe("Tiempo cumplido · cerrando…");
    expect(en("room.countdown.closing")).toMatch(/^Time's up. Finish your answer/);
    expect(es("room.countdown.closing")).toMatch(/^Se cumplió el tiempo. Termina tu respuesta/);
    expect(en("room.countdown.goodbye")).toBe("The interviewer is saying goodbye.");
    expect(es("room.countdown.goodbye")).toBe("El entrevistador se está despidiendo.");
  });
});
