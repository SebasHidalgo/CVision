/**
 * Provisional cap on rehearsals of one analysis. A constant, not a quota: M1b
 * replaces it with per-user limits. Import-free, like lib/elevenlabs/limits.ts,
 * so client components can read it for copy without pulling anything else.
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
