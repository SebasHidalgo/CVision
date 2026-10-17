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
