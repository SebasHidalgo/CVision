import { INTERVIEW_WRAP_UP_SECONDS } from "@/lib/interviewLimits";

/** The interviewer's only clock: silent contextual updates; the wrap-up line is its one cue to close. */
export type TimeNoteId = "half" | "two" | "wrap";
export type TimeNote = { id: TimeNoteId; text: string };

const TWO_MINUTES = 120;
/** A note this close to the next one is skipped: two lines in a row say nothing new. */
const MIN_GAP_SECONDS = 15;

const WRAP_TEXT = "[time] About one minute remains in this call. Finish the current exchange, give your closing line, and end the call.";
const TWO_TEXT =
  "[time] About two minutes remain. Keep asking: keep follow-ups short and do not open a large new topic. Do not close yet; another [time] line will say when. Do not reply to this line.";
const halfText = (minutes: number) =>
  `[time] Half of the interview time has passed; about ${minutes} minutes remain. Keep asking questions. Do not reply to this line.`;

/** The note due at `elapsed` of `callSeconds`, or null; a later note supersedes a missed earlier one. */
export function dueTimeNote(callSeconds: number, elapsed: number, sent: ReadonlySet<TimeNoteId>): TimeNote | null {
  const left = callSeconds - elapsed;
  if (!sent.has("wrap") && left <= INTERVIEW_WRAP_UP_SECONDS) return { id: "wrap", text: WRAP_TEXT };
  if (!sent.has("two") && !sent.has("wrap") && callSeconds >= TWO_MINUTES + 60 && left <= TWO_MINUTES && left > INTERVIEW_WRAP_UP_SECONDS + MIN_GAP_SECONDS) {
    return { id: "two", text: TWO_TEXT };
  }
  if (
    !sent.has("half") &&
    !sent.has("two") &&
    !sent.has("wrap") &&
    callSeconds >= 240 &&
    elapsed >= Math.floor(callSeconds / 2) &&
    left > TWO_MINUTES + MIN_GAP_SECONDS
  ) {
    return { id: "half", text: halfText(Math.floor(left / 60)) };
  }
  return null;
}
