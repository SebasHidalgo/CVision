"use client";

import { useCallback, useEffect, useState } from "react";
import { readTurn, stepTurn, TURN_START, type Turn, type TurnEvent, type TurnState } from "@/components/interview/room/turn";
import { CANDIDATE_SOUND_LEVEL } from "../utils/closing";

/** How often the candidate's microphone is read inside the interviewer's pause. */
const LISTEN_EVERY_MS = 120;

/**
 * The turn of a live call (components/interview/room/turn.ts), stepped by the call's events as they arrive. Inside
 * the interviewer's pause it reads the candidate's microphone, so a candidate who starts answering gets the turn
 * without waiting for the hold. With `opening` the call is already open, so the interviewer holds the turn from the start.
 */
export function useTurn(candidateLevel: () => number, opening = false): { turn: Turn; voice: boolean; push: (event: TurnEvent) => void } {
  const [state, setState] = useState<TurnState>(() => (opening ? stepTurn(TURN_START, "connected", Date.now()) : TURN_START));
  // The time the reading is for: the last event, or the moment the last reading ran out.
  const [now, setNow] = useState(() => Date.now());

  const push = useCallback((event: TurnEvent) => {
    const at = Date.now();
    setState((current) => stepTurn(current, event, at));
    setNow(at);
  }, []);

  const reading = readTurn(state, now);

  useEffect(() => {
    if (reading.until === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, reading.until - Date.now()) + 5);
    return () => window.clearTimeout(timer);
  }, [reading.until]);

  useEffect(() => {
    if (!reading.listen) return;
    const timer = window.setInterval(() => {
      if (candidateLevel() >= CANDIDATE_SOUND_LEVEL) push("candidate-voice");
    }, LISTEN_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [reading.listen, candidateLevel, push]);

  return { turn: reading.turn, voice: state.phase === "speaking", push };
}
