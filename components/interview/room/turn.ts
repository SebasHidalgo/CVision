/**
 * Who holds the turn in a voice call, from what a room can observe. The platform's "speaking" flag drops between the
 * interviewer's audio chunks and while it composes its next line, so on its own it says "your turn" too early. Pure:
 * the app's room steps it with the call's events, the landing's replica folds its script through it.
 */

/** interviewer: its voice is playing, or paused between two of its sentences; waiting: it holds the turn in silence (opening the call, composing a reply); candidate: the candidate's turn. */
export type Turn = "interviewer" | "waiting" | "candidate";

export type TurnEvent =
  /** The call connected: the interviewer opens it. */
  | "connected"
  /** The interviewer's audio started or stopped. */
  | "voice-start"
  | "voice-stop"
  /** A finished line arrived: the interviewer's as it starts its turn, the candidate's once the platform ends theirs. */
  | "interviewer-line"
  | "candidate-line"
  /** The candidate is heard while the interviewer is silent. */
  | "candidate-voice"
  /** The candidate cut the interviewer off. */
  | "interrupted";

export type TurnState =
  | { readonly phase: "speaking" }
  | { readonly phase: "pause"; readonly since: number }
  | { readonly phase: "waiting"; readonly since: number }
  | { readonly phase: "candidate" };

/** A pause in the interviewer's audio shorter than this is between two of its sentences, not the end of its turn. */
export const TURN_HOLD_MS = 1_200;
/** Silent this long while holding the turn, the interviewer is not about to speak: the turn is the candidate's. */
export const TURN_WAIT_CAP_MS = 8_000;

/** Before any event: nobody is speaking. */
export const TURN_START: TurnState = { phase: "candidate" };

export function stepTurn(state: TurnState, event: TurnEvent, at: number): TurnState {
  switch (event) {
    case "connected":
      return { phase: "waiting", since: at };
    case "voice-start":
      return { phase: "speaking" };
    case "voice-stop":
      return state.phase === "speaking" ? { phase: "pause", since: at } : state;
    case "interviewer-line":
    case "candidate-line":
      // A line while the interviewer's voice plays belongs to that turn; otherwise the interviewer now composes.
      return state.phase === "speaking" ? state : { phase: "waiting", since: at };
    case "candidate-voice":
      // Only inside a pause: while the interviewer composes, a sound from the candidate is not their turn yet.
      return state.phase === "pause" ? { phase: "candidate" } : state;
    case "interrupted":
      return { phase: "candidate" };
  }
}

type TurnReading = {
  turn: Turn;
  /** When the reading changes with no further event (ms), or null. */
  until: number | null;
  /** Inside the interviewer's pause: a candidate who is heard takes the turn now. */
  listen: boolean;
};

export function readTurn(state: TurnState, now: number): TurnReading {
  switch (state.phase) {
    case "speaking":
      return { turn: "interviewer", until: null, listen: false };
    case "pause": {
      const until = state.since + TURN_HOLD_MS;
      return now < until ? { turn: "interviewer", until, listen: true } : { turn: "candidate", until: null, listen: false };
    }
    case "waiting": {
      const until = state.since + TURN_WAIT_CAP_MS;
      return now < until ? { turn: "waiting", until, listen: false } : { turn: "candidate", until: null, listen: false };
    }
    case "candidate":
      return { turn: "candidate", until: null, listen: false };
  }
}

export type TimedTurnEvent = { readonly at: number; readonly event: TurnEvent };

/** The state after every event up to `now` (events in time order). */
export function foldTurn(events: readonly TimedTurnEvent[], now: number): TurnState {
  let state = TURN_START;
  for (const { at, event } of events) {
    if (at > now) break;
    state = stepTurn(state, event, at);
  }
  return state;
}
