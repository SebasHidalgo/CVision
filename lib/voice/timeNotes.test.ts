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
      "[time] Half of the interview time has passed; about 6 minutes remain. Keep asking questions. Do not reply to this line.",
    );
    expect(dueTimeNote(300, 230, new Set(["half", "two"]))?.text).toContain("give your closing line, and end the call");
  });
});
