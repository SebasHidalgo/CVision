import { INTERVIEW_WRAP_UP_SECONDS } from "@/lib/interviewLimits";

/** The interviewer's only clock: silent contextual updates; the wrap-up line is its one cue to close. */
export type TimeNoteId = "half" | "two" | "wrap";
export type TimeNote = { id: TimeNoteId; text: string };

const TWO_MINUTES = 120;
/** A note this close to the next one is skipped: two lines in a row say nothing new. */
const MIN_GAP_SECONDS = 15;

/** The close: never over a pending question, and the goodbye is spoken before end_call. */
export const WRAP_TEXT =
  "[time] About one minute remains in this call. Ask nothing new. First check whether the candidate has answered your last question. If they have not, do not say goodbye and do not call end_call: wait for the answer, and if they stay silent say only a short \"take your time\" in the call's language. Once they have answered, or if no question was pending, say the goodbye (thank them, and say their feedback will appear on their screen in a moment) and call end_call in that same turn. Do not reply to this line.";
/** Not the end: nothing in it may be announced to the candidate. */
export const TWO_TEXT =
  "[time] About two minutes remain. This is not the end: keep asking, with short follow-ups and no large new topic. Do not say goodbye, do not announce a last question or that you are closing, and do not call end_call; another [time] line will say when. Do not reply to this line.";
export const halfText = (minutes: number) =>
  `[time] Half of the interview time has passed; about ${minutes} minutes remain. Keep asking questions as before and do not mention the time. Do not reply to this line.`;

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
