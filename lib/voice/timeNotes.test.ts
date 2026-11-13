import { describe, expect, it } from "vitest";
import { dueTimeNote, halfText, ONE_TEXT, TWO_TEXT, UP_TEXT, type TimeNoteId } from "./timeNotes";

/** Every note a call would send, second by second, as the room does; the room keeps ticking through the grace. */
function schedule(callSeconds: number, graceSeconds = 60): Array<[TimeNoteId, number]> {
  const sent = new Set<TimeNoteId>();
  const out: Array<[TimeNoteId, number]> = [];
  for (let elapsed = 0; elapsed <= callSeconds + graceSeconds; elapsed++) {
    const note = dueTimeNote(callSeconds, elapsed, sent);
    if (!note) continue;
    sent.add(note.id);
    out.push([note.id, callSeconds - elapsed]);
  }
  return out;
}

describe("dueTimeNote", () => {
  it("paces a 12-minute interview at half time, two minutes, one minute, and says the time is up at 0:00", () => {
    expect(schedule(720)).toEqual([
      ["half", 360],
      ["two", 120],
      ["one", 60],
      ["up", 0],
    ]);
  });

  it("paces the 5-minute trial the same way", () => {
    expect(schedule(300)).toEqual([
      ["half", 150],
      ["two", 120],
      ["one", 60],
      ["up", 0],
    ]);
  });

  it("gives a short resumed call only the lines that still mean something", () => {
    expect(schedule(200)).toEqual([
      ["two", 120],
      ["one", 60],
      ["up", 0],
    ]);
    expect(schedule(100)).toEqual([
      ["one", 60],
      ["up", 0],
    ]);
    // Too short for a last-minute line: only the end.
    expect(schedule(60)).toEqual([["up", 0]]);
    expect(schedule(40)).toEqual([["up", 0]]);
  });

  it("says the time is up exactly at 0:00 of the paid length, never before, and nothing after it", () => {
    const before = new Set<TimeNoteId>(["half", "two", "one"]);
    for (const elapsed of [241, 280, 299]) expect(dueTimeNote(300, elapsed, before)).toBeNull();
    expect(dueTimeNote(300, 300, before)).toEqual({ id: "up", text: UP_TEXT });
    // A tick that came late still says it, once.
    expect(dueTimeNote(300, 303, before)?.id).toBe("up");
    const after = new Set<TimeNoteId>([...before, "up"]);
    for (const elapsed of [300, 301, 330, 360, 400]) expect(dueTimeNote(300, elapsed, after)).toBeNull();
  });

  it("supersedes a missed earlier line with the later one, and never goes back", () => {
    // The room missed half and two (a stalled tab): the last-minute line is what is due.
    expect(dueTimeNote(300, 245, new Set())?.id).toBe("one");
    expect(dueTimeNote(300, 250, new Set(["one"]))).toBeNull();
    // Missed everything: the end.
    expect(dueTimeNote(300, 300, new Set())?.id).toBe("up");
  });

  it("says how much is left at half time, and that it is not a line to answer", () => {
    expect(dueTimeNote(720, 360, new Set())?.text).toBe(
      "[time] Half of the interview time has passed; about 6 minutes remain. Keep asking questions as before and do not mention the time. Do not reply to this line.",
    );
  });

  it("tells the interviewer to keep going at two minutes, without naming the ending", () => {
    const two = dueTimeNote(300, 180, new Set(["half"]))?.text ?? "";
    expect(two).toBe(TWO_TEXT);
    expect(two).toContain("Keep the interview going as before");
    expect(two).toContain("do not mention the time");
    expect(two).toContain("Another [time] line will say when the time is up");
  });

  it("keeps the interview going in the last minute: short questions, and no word of goodbye or the tool", () => {
    const one = dueTimeNote(300, 240, new Set(["half", "two"]))?.text ?? "";
    expect(one).toBe(ONE_TEXT);
    expect(one).toContain("About one minute remains");
    expect(one).toContain("ask short questions or short follow-ups");
    expect(one).toContain("Another [time] line will say when the time is up");
  });

  it("never names the goodbye, the closing or the tool before 0:00, even to forbid them", () => {
    for (const text of [ONE_TEXT, TWO_TEXT, halfText(6)]) expect(text).not.toMatch(/goodbye|end_interview|closing|clos|last question|wrap/i);
  });

  it("at 0:00 hears the pending answer out, then says the goodbye and asks the room in that same turn", () => {
    const up = dueTimeNote(300, 300, new Set(["half", "two", "one"]))?.text ?? "";
    expect(up).toContain("The interview time is up. Ask nothing new.");
    expect(up).toContain("If the candidate is answering or still owes you an answer to your last question, wait for it");
    expect(up).toContain('say only a short "take your time"');
    expect(up).toContain("say the goodbye");
    expect(up).toContain("call end_interview with reason time_up in that same turn");
    expect(up).not.toContain("end_call");
  });
});
