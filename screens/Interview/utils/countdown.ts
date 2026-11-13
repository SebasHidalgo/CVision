/**
 * The room's clock counts the paid length of the call. At 0:00 it stops
 * counting and the room shows its closing label while the call runs on
 * through the grace. Its warnings are interface copy, in the interface
 * language, whatever language the session speaks.
 */
export const COUNTDOWN_WARNING_SECONDS = 60;
export const COUNTDOWN_FINAL_SECONDS = 10;

export type CountdownPhase = "normal" | "warning" | "final";

export function countdownPhase(remainingSeconds: number): CountdownPhase {
  if (remainingSeconds <= COUNTDOWN_FINAL_SECONDS) return "final";
  if (remainingSeconds <= COUNTDOWN_WARNING_SECONDS) return "warning";
  return "normal";
}

/** Seconds left on the clock, never negative. */
export function remainingSeconds(
  maxDurationSeconds: number,
  connectedAtMs: number,
  nowMs: number,
): number {
  const elapsed = Math.floor((nowMs - connectedAtMs) / 1000);
  return Math.max(0, maxDurationSeconds - elapsed);
}

/** "11:59", "0:09". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const NOTICE_KEY = {
  warning: "room.countdown.warning",
  final: "room.countdown.final",
} as const satisfies Record<Exclude<CountdownPhase, "normal">, string>;

/** The `interview`-namespace key of what the clock says, or nothing while time is normal. */
export function countdownNoticeKey(phase: CountdownPhase): (typeof NOTICE_KEY)[keyof typeof NOTICE_KEY] | null {
  return phase === "normal" ? null : NOTICE_KEY[phase];
}
