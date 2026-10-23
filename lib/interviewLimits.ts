/**
 * The interview limits the browser also shows. Import-free so a client
 * component can read them without pulling the agent definition and the
 * interviewer prompt into its bundle. The product's quotas (how many
 * interviews a plan gets) live in lib/plans.ts.
 */

/** Hard cap of the full agent, enforced by the platform: billing stops here even if the tab hangs. */
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
 * (the agents hang up at twelve minutes) and past the reconcile window.
 */
export const INTERVIEW_ABANDON_MS = 2 * 60 * 60_000;
