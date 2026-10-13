/**
 * The two interview limits the browser also shows. Kept in a file with no
 * imports so a client component can read them without pulling the agent
 * definition and the interviewer prompt into its bundle.
 */

/** Hard cap enforced by the platform: billing stops here even if the tab hangs. */
export const MAX_INTERVIEW_DURATION_SECONDS = 12 * 60;

/**
 * Sessions one interview may issue: one real attempt plus two retries for a
 * dropped connection. Every start is a paid call, and before this an
 * unfinished interview could be restarted without limit.
 */
export const MAX_INTERVIEW_STARTS = 3;
