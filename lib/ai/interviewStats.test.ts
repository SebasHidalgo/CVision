import { describe, expect, it } from "vitest";
import type { TranscriptTurn } from "@/lib/elevenlabs/postCall";
import { computeInterviewStats, describeInterviewStats } from "./interviewStats";

const turn = (role: string, message: string, at: number | null): TranscriptTurn => ({
  role,
  message,
  time_in_call_secs: at,
});

const TIMED: TranscriptTurn[] = [
  turn("agent", "Hi Ana, tell me about your background.", 0),
  turn("user", "Sure. I have been building web apps for four years, mostly React.", 5),
  turn("agent", "What did you ship last?", 40),
  turn("user", "A checkout rewrite that cut load time by forty percent.", 45),
  turn("agent", "How did you measure that?", 100),
  turn("user", "With Lighthouse before and after, on the same pages.", 110),
];

describe("computeInterviewStats", () => {
  it("counts candidate turns and words, and measures time on the floor from turn starts", () => {
    const stats = computeInterviewStats(TIMED, 150);

    expect(stats).toEqual({
      totalTurns: 6,
      candidateTurns: 3,
      candidateWords: 12 + 10 + 9,
      averageCandidateTurnWords: 10.3,
      // (40-5) + (100-45) + (150-110)
      candidateOnFloorSeconds: 130,
      // 45 -> 100
      longestTurnGapSeconds: 55,
      durationSeconds: 150,
      short: true,
    });
  });

  it("uses the last turn start as the end when no duration is known", () => {
    const stats = computeInterviewStats(TIMED, null);

    // The last candidate turn gets no span: nothing starts after it.
    expect(stats.candidateOnFloorSeconds).toBe(90);
    expect(stats.durationSeconds).toBeNull();
  });

  it("reports timings as not measured when any turn lacks an offset", () => {
    const untimed = TIMED.map((t) => ({ ...t, time_in_call_secs: null }));
    const stats = computeInterviewStats([...untimed, turn("user", "One more answer here.", null)], null);

    expect(stats.candidateTurns).toBe(4);
    expect(stats.candidateOnFloorSeconds).toBeNull();
    expect(stats.longestTurnGapSeconds).toBeNull();
    // Four turns, so not short by count; time unknown, so not short by time.
    expect(stats.short).toBe(false);
  });

  it("calls an interview short under two minutes even with enough turns", () => {
    const quick = [0, 10, 20, 30, 40, 50, 60, 70].map((at, i) =>
      turn(i % 2 ? "user" : "agent", "Yes, briefly.", at),
    );
    expect(computeInterviewStats(quick, 80).short).toBe(true);
  });

  it("ignores blank candidate turns and handles an empty transcript", () => {
    expect(computeInterviewStats([turn("user", "   ", 0)], 10).candidateTurns).toBe(0);
    expect(computeInterviewStats([], null)).toMatchObject({
      totalTurns: 0,
      candidateTurns: 0,
      averageCandidateTurnWords: 0,
      short: true,
    });
  });

  it("describes itself for the prompt, naming the short case", () => {
    const text = describeInterviewStats(computeInterviewStats(TIMED, 150));
    expect(text).toContain("Candidate turns: 3 of 6");
    expect(text).toContain("about 130 seconds");
    expect(text).toContain("SHORT");
  });
});
