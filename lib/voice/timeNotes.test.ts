import { describe, expect, it } from "vitest";
import { dueTimeNote, type TimeNoteId } from "./timeNotes";

/** Every note a call would send, second by second, as the room does. */
function schedule(callSeconds: number): Array<[TimeNoteId, number]> {
  const sent = new Set<TimeNoteId>();
  const out: Array<[TimeNoteId, number]> = [];
  for (let elapsed = 0; elapsed <= callSeconds; elapsed++) {
    const note = dueTimeNote(callSeconds, elapsed, sent);
    if (!note) continue;
    sent.add(note.id);
    out.push([note.id, callSeconds - elapsed]);
  }
  return out;
}

describe("dueTimeNote", () => {
  it("paces a 12-minute interview at half time, two minutes left and the wrap-up", () => {
    expect(schedule(720)).toEqual([
      ["half", 360],
      ["two", 120],
      ["wrap", 75],
    ]);
  });

  it("paces the 5-minute trial the same way", () => {
    expect(schedule(300)).toEqual([
      ["half", 150],
      ["two", 120],
      ["wrap", 75],
    ]);
  });

  it("gives a short resumed call only the lines that still mean something", () => {
    expect(schedule(200)).toEqual([
      ["two", 120],
      ["wrap", 75],
    ]);
    expect(schedule(100)).toEqual([["wrap", 75]]);
    expect(schedule(60)).toEqual([["wrap", 60]]);
  });

  it("says how much is left at half time, and that it is not a line to answer", () => {
    expect(dueTimeNote(720, 360, new Set())?.text).toBe(
      "[time] Half of the interview time has passed; about 6 minutes remain. Keep asking questions as before and do not mention the time. Do not reply to this line.",
    );
  });

  it("tells the interviewer that two minutes left is not the end", () => {
    const two = dueTimeNote(300, 180, new Set(["half"]))?.text ?? "";
    expect(two).toContain("This is not the end");
    expect(two).toContain("do not announce a last question or that you are closing");
    expect(two).toContain("do not call end_call");
  });

  it("closes only over an answered question, with the goodbye spoken in the same turn as end_call", () => {
    const wrap = dueTimeNote(300, 230, new Set(["half", "two"]))?.text ?? "";
    expect(wrap).toContain("First check whether the candidate has answered your last question");
    expect(wrap).toContain("do not say goodbye and do not call end_call");
    expect(wrap).toContain("say the goodbye");
    expect(wrap).toContain("call end_call in that same turn");
  });
});
