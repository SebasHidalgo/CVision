/**
 * The interview limits the browser also shows. Import-free so a client
 * component can read them without pulling the agent definition and the
 * interviewer prompt into its bundle.
 */

/** Hard cap enforced by the platform: billing stops here even if the tab hangs. */
export const MAX_INTERVIEW_DURATION_SECONDS = 12 * 60;

/**
 * Sessions one interview may issue: one real connection plus two retries for
 * a dropped one. Every start is a paid call, and before this an unfinished
 * interview could be restarted without limit.
 */
export const MAX_INTERVIEW_STARTS = 3;

/**
 * Provisional cap on rehearsals of one analysis. A constant, not a quota: M1b
 * replaces it with per-user limits.
 */
export const MAX_INTERVIEW_ATTEMPTS_PER_ANALYSIS = 3;

/**
 * Attempts in these states never produced a scoreable rehearsal (a lost
 * session, a silent microphone, a never-started interview) and do not count
 * against the cap. Everything else does, including one that is still live.
 */
export const UNCOUNTED_ATTEMPT_STATUSES: readonly string[] = ["FAILED", "EXPIRED"];

export function countsTowardCap(status: string): boolean {
  return !UNCOUNTED_ATTEMPT_STATUSES.includes(status);
}

/** How many of an analysis's attempts count against the cap. */
export function countedAttempts(attempts: readonly { status: string }[]): number {
  return attempts.filter((attempt) => countsTowardCap(attempt.status)).length;
}
