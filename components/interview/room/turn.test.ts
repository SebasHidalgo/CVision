import { describe, expect, it } from "vitest";
import { foldTurn, readTurn, stepTurn, TURN_HOLD_MS, TURN_START, TURN_WAIT_CAP_MS, type TimedTurnEvent, type Turn } from "./turn";

/** The turn the room shows at each of these times, for this call. */
function turnsAt(events: TimedTurnEvent[], times: number[]): Turn[] {
  return times.map((now) => readTurn(foldTurn(events, now), now).turn);
}

describe("the turn", () => {
  it("is the interviewer's from the moment the call connects: it opens, so nothing says 'your turn' before the greeting", () => {
    const events: TimedTurnEvent[] = [
      { at: 0, event: "connected" },
      { at: 900, event: "interviewer-line" },
      { at: 900, event: "voice-start" },
    ];
    expect(turnsAt(events, [0, 500, 899, 900, 3_000])).toEqual(["waiting", "waiting", "waiting", "interviewer", "interviewer"]);
  });

  it("stays the interviewer's through a pause between two of its sentences", () => {
    const events: TimedTurnEvent[] = [
      { at: 0, event: "voice-start" },
      { at: 2_000, event: "voice-stop" },
      { at: 2_700, event: "voice-start" },
      { at: 5_000, event: "voice-stop" },
    ];
    // The pause (2.0 s to 2.7 s) is shorter than the hold: the candidate never sees their turn inside it.
    expect(turnsAt(events, [1_000, 2_000, 2_400, 2_699, 2_700, 4_000])).toEqual(Array(6).fill("interviewer"));
  });

  it("passes to the candidate once the interviewer's audio has been quiet for the hold", () => {
    const events: TimedTurnEvent[] = [
      { at: 0, event: "voice-start" },
      { at: 4_000, event: "voice-stop" },
    ];
    expect(turnsAt(events, [4_000, 4_000 + TURN_HOLD_MS - 1, 4_000 + TURN_HOLD_MS, 60_000])).toEqual(["interviewer", "interviewer", "candidate", "candidate"]);
    expect(readTurn(foldTurn(events, 4_100), 4_100)).toEqual({ turn: "interviewer", until: 4_000 + TURN_HOLD_MS, listen: true });
  });

  it("passes to a candidate who is heard inside the pause, without waiting for the hold", () => {
    const paused = stepTurn(stepTurn(TURN_START, "voice-start", 0), "voice-stop", 1_000);
    expect(readTurn(stepTurn(paused, "candidate-voice", 1_300), 1_300).turn).toBe("candidate");
  });

  it("is the interviewer's while it composes after the candidate's answer, not the candidate's", () => {
    const events: TimedTurnEvent[] = [
      { at: 0, event: "voice-start" },
      { at: 3_000, event: "voice-stop" },
      // The candidate answers; the platform ends their turn with their line.
      { at: 12_000, event: "candidate-line" },
      { at: 13_800, event: "interviewer-line" },
      { at: 14_100, event: "voice-start" },
    ];
    expect(turnsAt(events, [8_000, 12_000, 13_000, 13_900, 14_100])).toEqual(["candidate", "waiting", "waiting", "waiting", "interviewer"]);
  });

  it("ignores the candidate's sound while the interviewer composes", () => {
    const composing = stepTurn(TURN_START, "candidate-line", 0);
    expect(readTurn(stepTurn(composing, "candidate-voice", 400), 400).turn).toBe("waiting");
  });

  it("gives the turn back when the interviewer holds it in silence for too long", () => {
    const events: TimedTurnEvent[] = [{ at: 0, event: "candidate-line" }];
    expect(turnsAt(events, [TURN_WAIT_CAP_MS - 1, TURN_WAIT_CAP_MS])).toEqual(["waiting", "candidate"]);
  });

  it("is the candidate's at once when they cut the interviewer off", () => {
    const events: TimedTurnEvent[] = [
      { at: 0, event: "voice-start" },
      { at: 1_500, event: "interrupted" },
      { at: 1_550, event: "voice-stop" },
    ];
    expect(turnsAt(events, [1_400, 1_500, 1_520, 1_600])).toEqual(["interviewer", "candidate", "candidate", "candidate"]);
  });

  it("keeps a line that arrives while the interviewer speaks inside its turn", () => {
    const speaking = stepTurn(TURN_START, "voice-start", 0);
    expect(stepTurn(speaking, "interviewer-line", 100)).toBe(speaking);
    expect(stepTurn(speaking, "candidate-line", 100)).toBe(speaking);
    expect(stepTurn(speaking, "candidate-voice", 100)).toBe(speaking);
  });

  it("reads only the events up to now, in order", () => {
    const events: TimedTurnEvent[] = [
      { at: 0, event: "voice-start" },
      { at: 10_000, event: "interrupted" },
    ];
    expect(foldTurn(events, 9_999)).toEqual({ phase: "speaking" });
    expect(foldTurn(events, 10_000)).toEqual({ phase: "candidate" });
  });
});
