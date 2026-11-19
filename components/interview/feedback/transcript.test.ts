import { describe, expect, it } from "vitest";
import { callTime, transcriptEntries } from "./transcript";

describe("transcriptEntries", () => {
  it("lists who said what and when, keeps the resumed call's marker, and drops turns with no words", () => {
    const result = transcriptEntries([
      { role: "agent", message: "Tell me about the migration.", time_in_call_secs: 3.7 },
      { role: "user", message: "We moved six services.", time_in_call_secs: 65 },
      { role: "agent", message: "...", time_in_call_secs: 80 },
      { role: "user", message: null },
      { role: "system", message: "[call resumed]" },
      { role: "agent", message: "Welcome back.", time_in_call_secs: null },
    ]);
    expect(result?.lines).toBe(3);
    expect(result?.entries).toEqual([
      { kind: "line", key: 0, who: "interviewer", text: "Tell me about the migration.", at: "0:03" },
      { kind: "line", key: 1, who: "candidate", text: "We moved six services.", at: "1:05" },
      { kind: "marker", key: 4 },
      { kind: "line", key: 5, who: "interviewer", text: "Welcome back.", at: null },
    ]);
  });

  it("is null when nothing was said", () => {
    expect(transcriptEntries([{ role: "agent", message: "..." }])).toBeNull();
    expect(transcriptEntries([])).toBeNull();
  });

  it("formats a call time, and refuses what is not one", () => {
    expect(callTime(0)).toBe("0:00");
    expect(callTime(725.9)).toBe("12:05");
    expect(callTime(-1)).toBeNull();
    expect(callTime(Number.NaN)).toBeNull();
    expect(callTime(undefined)).toBeNull();
  });
});
