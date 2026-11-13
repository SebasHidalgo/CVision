import { END_ALLOWED_AFTER_ANSWER, type EndDetail } from "@/lib/voice/callEnd";

// The end the room allowed, step by step: when it answers the held tool call and when it hangs up. Pure.

/** An allowed end with no goodbye heard this long: the interviewer may be waiting for the room's answer, so it gets it. */
export const GOODBYE_PROMPT_MS = 3_000;
/** After the room allows the end, the goodbye must start within this. */
export const GOODBYE_START_MS = 8_000;
/** The room hangs up once the interviewer has been quiet this long after the goodbye. */
export const GOODBYE_SETTLE_MS = 2_000;
/** The latest the room hangs up after allowing the end. */
export const GOODBYE_MAX_MS = 30_000;
/** A goodbye over an unanswered question: the candidate's silence this long after it is their answer. */
export const ANSWER_WAIT_MS = 15_000;

export type ClosingState = {
  detail: EndDetail;
  /** When the current wait began: the allowed call, or the candidate's answer. */
  at: number;
  /** The interviewer has been heard speaking since then. */
  spoke: boolean;
  quietSince: number | null;
  /** What the held tool call is answered with. */
  result: string;
  /** A question before the goodbye still waits for the candidate. */
  awaitAnswer: boolean;
  /** The candidate's lines when the wait began: one more is their answer. */
  userLines: number;
  /** When the candidate's microphone last carried sound: an answer under way is not silence. */
  heardAt?: number | null;
};

/** The microphone level (0 to 1) read as the candidate speaking. An estimate, not measured on calls. */
export const CANDIDATE_SOUND_LEVEL = 0.05;

export type ClosingTick = { now: number; speaking: boolean; userLines: number; candidateLevel?: number };
export type ClosingStep = { state: ClosingState; release: boolean; hangUp: boolean };

export function stepClosing(previous: ClosingState, { now, speaking, userLines, candidateLevel = 0 }: ClosingTick): ClosingStep {
  let state: ClosingState = { ...previous };
  if (candidateLevel >= CANDIDATE_SOUND_LEVEL) state.heardAt = now;
  if (speaking) {
    state.spoke = true;
    state.quietSince = null;
  } else if (state.spoke && state.quietSince === null) {
    state.quietSince = now;
  }

  if (state.awaitAnswer) {
    // The answer came: the interviewer may say one short goodbye, then the room hangs up.
    if (userLines > state.userLines) {
      return { state: { ...state, awaitAnswer: false, at: now, spoke: speaking, quietSince: null, result: END_ALLOWED_AFTER_ANSWER, userLines }, release: false, hangUp: false };
    }
    const silentFor = speaking ? 0 : now - Math.max(state.quietSince ?? state.at, state.heardAt ?? 0);
    if (silentFor < ANSWER_WAIT_MS) return { state, release: false, hangUp: false };
    // Silence: the goodbye was said, so the call ends; with none heard, the interviewer is asked for it now.
    if (state.spoke) return { state, release: true, hangUp: true };
    state = { ...state, awaitAnswer: false, at: now - GOODBYE_PROMPT_MS };
  }

  const waited = now - state.at;
  const done = state.spoke ? state.quietSince !== null && now - state.quietSince >= GOODBYE_SETTLE_MS : waited >= GOODBYE_START_MS;
  if (done || waited >= GOODBYE_MAX_MS) return { state, release: true, hangUp: true };
  // Nothing heard yet: the interviewer called the tool without the goodbye, or waits for the answer before speaking.
  return { state, release: !state.spoke && waited >= GOODBYE_PROMPT_MS, hangUp: false };
}
