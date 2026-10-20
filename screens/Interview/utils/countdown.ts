import type { InterviewLanguage } from "@/lib/ai/postingLanguage";

/**
 * The room's clock is display only: the agent's own limit ends the call. The
 * clock exists so the candidate can finish an answer before that happens,
 * and so a Spanish session gets its warning in Spanish before the platform's
 * English cutoff line.
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

const NOTICE: Record<InterviewLanguage, Record<Exclude<CountdownPhase, "normal">, string>> = {
  en: {
    warning: "One minute left. Finish the answer you are on.",
    final: "Time is up. The interviewer is wrapping up.",
  },
  es: {
    warning: "Queda un minuto. Termina la respuesta que estás dando.",
    final: "Se acabó el tiempo. La entrevistadora está cerrando.",
  },
};

/** What the clock says in the session's language, or nothing while time is normal. */
export function countdownNotice(phase: CountdownPhase, language: InterviewLanguage): string | null {
  return phase === "normal" ? null : NOTICE[language][phase];
}
