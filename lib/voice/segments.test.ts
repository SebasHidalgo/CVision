import { describe, expect, it } from "vitest";
import { computeInterviewStats } from "@/lib/ai/interviewStats";
import { formatTranscript, interviewFeedbackPrompt } from "@/lib/ai/prompts/interview-feedback.prompt";
import {
  addSegment,
  continuityRecord,
  MAX_CONTINUITY_ANSWER_CHARS,
  MAX_CONTINUITY_QUESTION_CHARS,
  CALL_RESUMED_MARKER,
  isResumeMarker,
  mergeSegments,
  MIN_RESUME_SECONDS,
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
  const turn = (role: string, message: string | null, at = 0) => ({ role, message, time_in_call_secs: at });

  it("pairs each thing the interviewer asked with the gist of the answer, oldest first", () => {
    expect(continuityRecord(first.turns)).toEqual({
      exchanges: [{ question: "Hi Ana. Tell me about a migration you led?", answer: "I moved our billing to Postgres." }],
      pending: null,
    });
  });

  it("keeps the last question apart when the call dropped before any answer to it", () => {
    const record = continuityRecord([...first.turns, turn("agent", "Good. How did you plan the cutover, and who signed it off?", 30)]);
    expect(record.exchanges).toHaveLength(1);
    expect(record.pending).toBe("Good. How did you plan the cutover, and who signed it off?");
  });

  it("does not call a last line pending when it asks nothing, or when only a hesitation followed it", () => {
    expect(continuityRecord([...first.turns, turn("agent", "Understood, thank you.", 30)]).pending).toBeNull();
    const cutShort = continuityRecord([...first.turns, turn("agent", "And how did you test it?", 30), turn("user", "Ehh, mmm...", 36)]);
    expect(cutShort.pending).toBe("And how did you test it?");
    expect(cutShort.exchanges).toHaveLength(1);
  });

  it("cuts the hesitations out of an answer and keeps its start on one line", () => {
    const record = continuityRecord([
      turn("agent", "¿Cuánto tiempo llevas con Kotlin?"),
      turn("user", "Mmm, a ver. Eh, llevo dos años con Kotlin,\n eh, sobre todo en apps internas. Ah, y uno con Swift."),
    ]);
    expect(record.exchanges[0]).toEqual({
      question: "¿Cuánto tiempo llevas con Kotlin?",
      answer: "a ver. llevo dos años con Kotlin, sobre todo en apps internas. y uno con Swift.",
    });
    const long = continuityRecord([turn("agent", "Tell me more?"), turn("user", "word ".repeat(200))]).exchanges[0].answer;
    expect(long.length).toBe(MAX_CONTINUITY_ANSWER_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });

  it("keeps the end of a long interviewer turn, from a sentence start: the question is what it closes with", () => {
    const lead = "The role is demanding. ".repeat(30);
    const { question } = continuityRecord([turn("agent", `${lead}We need three years of SQL. Where have you run SQL in production?`), turn("user", "At Northwind.")]).exchanges[0];
    expect(question.length).toBeLessThanOrEqual(MAX_CONTINUITY_QUESTION_CHARS);
    expect(question.endsWith("We need three years of SQL. Where have you run SQL in production?")).toBe(true);
    expect(question.startsWith("The role is demanding.")).toBe(true);
  });

  it("joins a speaker's consecutive turns and skips the silent ones (a tool call)", () => {
    const record = continuityRecord([
      turn("agent", "First part."),
      turn("agent", null),
      turn("agent", "What did you ship?"),
      turn("user", "A cart."),
      turn("user", "And a checkout."),
    ]);
    expect(record.exchanges).toEqual([{ question: "First part. What did you ship?", answer: "A cart. And a checkout." }]);
  });

  it("across calls: the line that says the call is picking up is no exchange, and a pending question asked again is one", () => {
    const dropped: CallSegment = { ...first, turns: [...first.turns, turn("agent", "How did you plan the cutover?", 30)] };
    const resumed: CallSegment = {
      ...second,
      turns: [
        turn("agent", "Welcome back, Ana. The call dropped, so we will pick up where we left off.", 0),
        turn("user", "Sure, sorry about that.", 5),
        turn("agent", "Before we were cut off I had asked: how did you plan the cutover?", 8),
        turn("user", "With a runbook and a rollback rehearsal.", 15),
        turn("agent", "And what went wrong on the day?", 30),
      ],
    };
    const record = continuityRecord(mergeSegments([dropped, resumed]));
    expect(record.exchanges.map((exchange) => exchange.question)).toEqual(["Hi Ana. Tell me about a migration you led?", "Before we were cut off I had asked: how did you plan the cutover?"]);
    expect(record.exchanges[1].answer).toBe("With a runbook and a rollback rehearsal.");
    // Only where the interview stopped: the first call's unanswered question was asked again, the second's is pending.
    expect(record.pending).toBe("And what went wrong on the day?");
  });

  it("has nothing to say about a call in which only the candidate is on record", () => {
    expect(continuityRecord([turn("user", "Why do you ask that?")])).toEqual({ exchanges: [], pending: null });
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
