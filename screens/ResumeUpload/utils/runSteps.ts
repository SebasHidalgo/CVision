import type { UploadStage } from "./upload";

/**
 * What the browser itself sees of a run: the upload (signed URL and PUT), the
 * analysis request in flight, and the navigation to the saved analysis. The
 * analysis is one request that answers once, so nothing finer is observable.
 */
export type RunPhase = UploadStage | "opening";

export const RUN_PHASES = ["uploading", "analyzing", "opening"] as const satisfies readonly RunPhase[];

/** When each phase began (Date.now()), as the form recorded it. */
export type RunClock = Partial<Record<RunPhase, number>>;

export type StepState = "done" | "now" | "next";

export type RunStep = {
  phase: RunPhase;
  state: StepState;
  /** Whole seconds the step took (done) or has taken so far (now); null for a step not reached. */
  seconds: number | null;
};

/** The three steps for the current phase, each with the time it really took. */
export function runSteps(current: RunPhase, startedAt: RunClock, now: number): RunStep[] {
  const at = RUN_PHASES.indexOf(current);
  return RUN_PHASES.map((phase, i) => {
    if (i > at) return { phase, state: "next", seconds: null };
    const start = startedAt[phase];
    const end = i < at ? startedAt[RUN_PHASES[i + 1]] : now;
    const seconds = start === undefined || end === undefined ? null : Math.max(0, Math.floor((end - start) / 1000));
    return { phase, state: i < at ? "done" : "now", seconds };
  });
}

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
