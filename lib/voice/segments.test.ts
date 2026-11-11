import { describe, expect, it } from "vitest";
import { computeInterviewStats } from "@/lib/ai/interviewStats";
import { formatTranscript, interviewFeedbackPrompt } from "@/lib/ai/prompts/interview-feedback.prompt";
import {
  addSegment,
  CALL_RESUMED_MARKER,
  isResumeMarker,
  mergeSegments,
  MIN_RESUME_SECONDS,
  questionsAsked,
  readSegments,
  resumeState,
  usedSeconds,
  type CallSegment,
  type ResumeFacts,
} from "./segments";

const first: CallSegment = {
  conversationId: "conv_a",
  turns: [
    { role: "agent", message: "Hi Ana. Tell me about a migration you led?", time_in_call_secs: 0 },
    { role: "user", message: "I moved our billing to Postgres.", time_in_call_secs: 8 },
  ],
  durationSeconds: 192,
  startTimeSeconds: 1_000,
};
const second: CallSegment = {
  conversationId: "conv_b",
  turns: [
    { role: "agent", message: "Welcome back. How did you test the cutover?", time_in_call_secs: 0 },
    { role: "user", message: "With a shadow write for two weeks.", time_in_call_secs: 6 },
  ],
  durationSeconds: 240,
  startTimeSeconds: 2_000,
};

describe("segments: storage", () => {
  it("reads what was stored and treats anything else as none", () => {
    expect(readSegments([first])).toEqual([first]);
    expect(readSegments(null)).toEqual([]);
    expect(readSegments({ nope: true })).toEqual([]);
    expect(readSegments([{ conversationId: "x" }])).toEqual([]);
  });

  it("adds a call once, in start order", () => {
    expect(addSegment([second], first).map((segment) => segment.conversationId)).toEqual(["conv_a", "conv_b"]);
    expect(addSegment([first, second], { ...second, durationSeconds: 1 })).toEqual([first, second]);
  });
});

describe("segments: one transcript from several calls", () => {
  const merged = mergeSegments([first, second]);

  it("keeps the order, continues the clock and puts a neutral marker between two calls", () => {
    expect(merged.map((turn) => `${turn.role}@${turn.time_in_call_secs}`)).toEqual(["agent@0", "user@8", "system@192", "agent@192", "user@198"]);
    expect(merged[2].message).toBe(CALL_RESUMED_MARKER);
    expect(merged.filter(isResumeMarker)).toHaveLength(1);
    expect(mergeSegments([first])).toEqual(first.turns);
  });

  it("sums the stats over every call and does not count the marker as a turn", () => {
    const stats = computeInterviewStats(merged, 432, 720);
    expect(stats.totalTurns).toBe(4);
    expect(stats.candidateTurns).toBe(2);
    expect(stats.durationSeconds).toBe(432);
    // The first answer runs to the end of its call (192 - 8), the second to the end of the interview (432 - 198).
    expect(stats.candidateOnFloorSeconds).toBe(184 + 234);
  });

  it("shows the marker to the model as a neutral line, and only then explains it", () => {
    expect(formatTranscript(merged)).toContain(`--- ${CALL_RESUMED_MARKER} ---`);
    expect(formatTranscript(merged)).not.toContain("INTERVIEWER [3:12]: [call resumed]");

    const base = { candidateName: "Ana", role: "Engineer", company: "Northwind", jobDescription: "Build things.", analysisSummary: "Fine.", requirements: [], gaps: [], language: "en" as const };
    const resumed = interviewFeedbackPrompt({ ...base, turns: merged, stats: computeInterviewStats(merged, 432, 720) });
    const single = interviewFeedbackPrompt({ ...base, turns: first.turns, stats: computeInterviewStats(first.turns, 192, 720) });
    expect(resumed).toContain("It is neutral");
    expect(single).not.toContain("call resumed");
    expect(single).not.toContain("It is neutral");
  });
});

describe("segments: the continuity record", () => {
  it("lists the interviewer's questions, verbatim, oldest first", () => {
    expect(questionsAsked(mergeSegments([first, second]))).toEqual(["Tell me about a migration you led?", "How did you test the cutover?"]);
    expect(questionsAsked([{ role: "user", message: "Why do you ask that?" }])).toEqual([]);
  });
});

describe("segments: the clock and the resume window", () => {
  const now = new Date("2026-11-11T12:10:00Z");
  const facts = (overrides: Partial<ResumeFacts> = {}): ResumeFacts => ({
    segments: [],
    latestRecorded: true,
    latestSpoke: true,
    latestDurationSeconds: 192,
    lastSessionAt: new Date("2026-11-11T12:00:00Z"),
    endedAt: new Date("2026-11-11T12:03:12Z"),
    status: "IN_PROGRESS",
    resumableUntil: new Date("2026-11-11T12:13:12Z"),
    startCount: 1,
    ...overrides,
  });

  it("counts recorded calls by what the platform measured", () => {
    expect(usedSeconds(facts(), now)).toBe(192);
    expect(usedSeconds(facts({ segments: [first], latestDurationSeconds: 240 }), now)).toBe(432);
  });

  it("counts nothing for a recorded call in which nobody spoke", () => {
    expect(usedSeconds(facts({ latestSpoke: false }), now)).toBe(0);
  });

  it("counts a call with no record yet on the server's clock: to the room's report, or to now", () => {
    expect(usedSeconds(facts({ latestRecorded: false }), now)).toBe(192);
    expect(usedSeconds(facts({ latestRecorded: false, endedAt: null }), now)).toBe(600);
  });

  it("offers a reconnect with the time left while the window is open", () => {
    expect(resumeState(facts(), 720, 3, now)).toEqual({ resumable: true, usedSeconds: 192, remainingSeconds: 528, until: new Date("2026-11-11T12:13:12Z") });
  });

  it.each([
    ["the window is over", { resumableUntil: new Date("2026-11-11T12:09:59Z") }],
    ["no window was opened", { resumableUntil: null }],
    ["the last start is used", { startCount: 3 }],
    ["too little time is left", { latestDurationSeconds: 720 - MIN_RESUME_SECONDS + 1 }],
    ["the interview is no longer in progress", { status: "FEEDBACK_PENDING" }],
    ["nobody spoke in the only recorded call", { latestSpoke: false }],
  ])("offers none when %s", (_name, overrides) => {
    expect(resumeState(facts(overrides), 720, 3, now).resumable).toBe(false);
  });
});
