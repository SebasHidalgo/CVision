import { INTERVIEW_LAST_MINUTE_SECONDS } from "@/lib/interviewLimits";

/** The interviewer's only clock: silent contextual updates. It asks until the "up" line; only that line starts the goodbye. */
export type TimeNoteId = "half" | "two" | "one" | "up";
export type TimeNote = { id: TimeNoteId; text: string };

const TWO_MINUTES = 120;
/** A note this close to the next one is skipped: two lines in a row say nothing new. */
const MIN_GAP_SECONDS = 15;

/** The paid time is over: the last answer is heard out, then the goodbye and the tool. */
export const UP_TEXT =
  "[time] The interview time is up. Ask nothing new. If the candidate is answering or still owes you an answer to your last question, wait for it; if they stay silent, say only a short \"take your time\" in the call's language. Once they have answered, or if no question was pending, say the goodbye (thank them, and say their feedback will appear on their screen in a moment) and call end_interview with reason time_up in that same turn. Do not reply to this line.";
/** The last minute is still interview: short questions, no goodbye. */
export const ONE_TEXT =
  "[time] About one minute remains. This is not the end: keep asking, but only short questions or short follow-ups. Do not say goodbye, do not announce a last question or that you are closing, and do not call end_interview; another [time] line will say when the time is up. Do not reply to this line.";
/** Not the end: nothing in it may be announced to the candidate. */
export const TWO_TEXT =
  "[time] About two minutes remain. This is not the end: keep asking, with short follow-ups and no large new topic. Do not say goodbye, do not announce a last question or that you are closing, and do not call end_interview; another [time] line will say when the time is up. Do not reply to this line.";
export const halfText = (minutes: number) =>
  `[time] Half of the interview time has passed; about ${minutes} minutes remain. Keep asking questions as before and do not mention the time. Do not reply to this line.`;

/** The note due at `elapsed` of `callSeconds` (the paid length of this call), or null; a later note supersedes a missed earlier one. */
export function dueTimeNote(callSeconds: number, elapsed: number, sent: ReadonlySet<TimeNoteId>): TimeNote | null {
  const left = callSeconds - elapsed;
  if (!sent.has("up") && left <= 0) return { id: "up", text: UP_TEXT };
  if (sent.has("up")) return null;
  if (!sent.has("one") && callSeconds > INTERVIEW_LAST_MINUTE_SECONDS + MIN_GAP_SECONDS && left <= INTERVIEW_LAST_MINUTE_SECONDS && left > MIN_GAP_SECONDS) {
    return { id: "one", text: ONE_TEXT };
  }
  if (sent.has("one")) return null;
  if (!sent.has("two") && callSeconds >= TWO_MINUTES + 60 && left <= TWO_MINUTES && left > INTERVIEW_LAST_MINUTE_SECONDS + MIN_GAP_SECONDS) {
    return { id: "two", text: TWO_TEXT };
  }
  if (!sent.has("half") && !sent.has("two") && callSeconds >= 240 && elapsed >= Math.floor(callSeconds / 2) && left > TWO_MINUTES + MIN_GAP_SECONDS) {
    return { id: "half", text: halfText(Math.floor(left / 60)) };
  }
  return null;
}
