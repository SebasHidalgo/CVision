/**
 * The interview limits the browser also shows. Import-free so a client
 * component can read them without pulling the agent definition and the
 * interviewer prompt into its bundle. The product's quotas (how many
 * interviews a plan gets) live in lib/plans.ts.
 */

/** The paid length of the full interview. The platform cuts a call at this plus the grace (MAX_CALL_SECONDS), even if the tab hangs. */
export const MAX_INTERVIEW_DURATION_SECONDS = 12 * 60;

/**
 * Sessions one interview may issue: one real connection plus two retries for
 * a dropped one. Every start is a paid call, and before this an unfinished
 * interview could be restarted without limit.
 */
export const MAX_INTERVIEW_STARTS = 3;

/**
 * An interview that is IN_PROGRESS with starts left and has had no session
 * issued for this long never connected, or never got an answer, and is not
 * coming back: it is expired lazily wherever interviews or quotas are read,
 * and the unit its first token reserved is given back. Far past any call
 * (the platform cuts one at thirteen minutes) and past the reconcile window.
 */
export const INTERVIEW_ABANDON_MS = 2 * 60 * 60_000;

/** Time past the paid length for the last answer and the goodbye: the longest answer measured (43 s) plus a goodbye (15 s). */
export const INTERVIEW_GRACE_SECONDS = 60;

/** The longest any call may run on the platform: the full interview plus the grace. */
export const MAX_CALL_SECONDS = MAX_INTERVIEW_DURATION_SECONDS + INTERVIEW_GRACE_SECONDS;

/** With this much paid time left the interviewer keeps asking, but only short questions. */
export const INTERVIEW_LAST_MINUTE_SECONDS = 60;
