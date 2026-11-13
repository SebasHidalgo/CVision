import { describe, expect, it } from "vitest";
import { END_ALLOWED_AFTER_ANSWER, END_ALLOWED_QUIET } from "@/lib/voice/callEnd";
import { ANSWER_WAIT_MS, GOODBYE_MAX_MS, GOODBYE_PROMPT_MS, GOODBYE_SETTLE_MS, GOODBYE_START_MS, stepClosing, type ClosingState } from "./closing";

const START = 1_000_000;
const closing = (over: Partial<ClosingState> = {}): ClosingState => ({
  detail: "time_up",
  at: START,
  spoke: false,
  quietSince: null,
  result: END_ALLOWED_QUIET,
  awaitAnswer: false,
  userLines: 4,
  ...over,
});

/** Runs the room's ticks: each entry is a time offset, whether the interviewer is speaking, and the candidate's line count. */
function run(state: ClosingState, ticks: [number, boolean, number][]) {
  let current = state;
  const steps = [];
  for (const [offset, speaking, userLines] of ticks) {
    const step = stepClosing(current, { now: START + offset, speaking, userLines });
    current = step.state;
    steps.push({ offset, ...step });
    if (step.hangUp) break;
  }
  return steps;
}

describe("stepClosing: an allowed end", () => {
  it("hangs up once the goodbye has been spoken and the interviewer has been quiet for a moment", () => {
    const steps = run(closing(), [
      [0, true, 4],
      [4_000, false, 4],
      [4_000 + GOODBYE_SETTLE_MS - 100, false, 4],
      [4_000 + GOODBYE_SETTLE_MS, false, 4],
    ]);
    expect(steps.map((step) => step.hangUp)).toEqual([false, false, false, true]);
    expect(steps.at(-1)?.release).toBe(true);
  });

  it("with nothing heard, answers the held call after three seconds and hangs up after eight", () => {
    const steps = run(closing(), [
      [GOODBYE_PROMPT_MS - 1, false, 4],
      [GOODBYE_PROMPT_MS, false, 4],
      [GOODBYE_START_MS, false, 4],
    ]);
    expect(steps.map((step) => [step.release, step.hangUp])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
  });

  it("never waits past thirty seconds, even with the interviewer still speaking", () => {
    const steps = run(closing(), [
      [GOODBYE_MAX_MS - 1, true, 4],
      [GOODBYE_MAX_MS, true, 4],
    ]);
    expect(steps.map((step) => step.hangUp)).toEqual([false, true]);
  });
});

describe("stepClosing: a goodbye over a question the candidate has not answered (after 0:00)", () => {
  const overQuestion = closing({ awaitAnswer: true, spoke: true, quietSince: START });

  it("does not hang up when the goodbye ends: it waits for the answer", () => {
    const steps = run(overQuestion, [
      [GOODBYE_SETTLE_MS, false, 4],
      [10_000, false, 4],
    ]);
    expect(steps.every((step) => !step.hangUp && !step.release)).toBe(true);
  });

  it("15 s of silence after the goodbye, and no answer: the call ends", () => {
    const steps = run(overQuestion, [
      [ANSWER_WAIT_MS - 1, false, 4],
      [ANSWER_WAIT_MS, false, 4],
    ]);
    expect(steps.map((step) => step.hangUp)).toEqual([false, true]);
  });

  it("the candidate answers first: the interviewer gets a short goodbye of its own, then the room hangs up after it", () => {
    const steps = run(overQuestion, [
      [6_000, false, 5],
      [6_000 + GOODBYE_PROMPT_MS, false, 5],
      [7_000 + GOODBYE_PROMPT_MS, true, 5],
      [12_000, false, 5],
      [12_000 + GOODBYE_SETTLE_MS, false, 5],
    ]);
    expect(steps[0]).toMatchObject({ release: false, hangUp: false });
    expect(steps[0].state).toMatchObject({ awaitAnswer: false, at: START + 6_000, result: END_ALLOWED_AFTER_ANSWER });
    // Nothing heard three seconds after the answer: the held call is answered, asking for that goodbye.
    expect(steps[1]).toMatchObject({ release: true, hangUp: false });
    expect(steps.at(-1)).toMatchObject({ hangUp: true });
    expect(steps.at(-1)?.offset).toBe(12_000 + GOODBYE_SETTLE_MS);
  });

  it("a long answer is never cut by the fifteen seconds: sound on the microphone is not silence", () => {
    // The answer's words arrive as one line only when the candidate stops; until then the microphone says they are talking.
    let state = overQuestion;
    for (let offset = 10_000; offset <= 40_000; offset += 1_000) {
      const step = stepClosing(state, { now: START + offset, speaking: false, userLines: 4, candidateLevel: 0.2 });
      expect(step.hangUp).toBe(false);
      state = step.state;
    }
    // They stop and their line lands: the short goodbye, then the hang-up.
    const answered = stepClosing(state, { now: START + 41_000, speaking: false, userLines: 5, candidateLevel: 0 });
    expect(answered.state).toMatchObject({ awaitAnswer: false, result: END_ALLOWED_AFTER_ANSWER });
    // Room noise under the threshold is silence.
    expect(stepClosing(overQuestion, { now: START + ANSWER_WAIT_MS, speaking: false, userLines: 4, candidateLevel: 0.01 }).hangUp).toBe(true);
  });

  it("no goodbye was heard either: after 15 s the interviewer is asked for it, then the usual wait", () => {
    const steps = run(closing({ awaitAnswer: true }), [
      [ANSWER_WAIT_MS, false, 4],
      [ANSWER_WAIT_MS + 1_000, true, 4],
      [ANSWER_WAIT_MS + 4_000, false, 4],
      [ANSWER_WAIT_MS + 4_000 + GOODBYE_SETTLE_MS, false, 4],
    ]);
    expect(steps[0]).toMatchObject({ release: true, hangUp: false });
    expect(steps.at(-1)).toMatchObject({ hangUp: true });
  });
});
