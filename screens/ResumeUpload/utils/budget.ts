/**
 * The time budget of one analysis request, in one place. The upload page exports `maxDuration = 100` as a literal
 * (Next reads it statically); budget.test.ts holds these numbers against that literal and against the timeouts they
 * stand for, so the waits and the optional steps can never add up past it.
 *
 * Worst case, in order: the wait for an earlier request of the same submission (SUBMISSION_WAIT_MS), the file (the
 * download's 10 s timeout and the parse), the analysis call (30 s), then the optional steps (the English retry, the
 * repair) only on what is left before the model deadline, then the save. The translation at the end only runs on
 * what is left after the save.
 */

/** Everything the action does fits in this: the page's maxDuration less a margin. */
export const ACTION_BUDGET_MS = 95_000;

/** No request outlives the page's maxDuration; the margin covers clock skew between instances. */
export const REQUEST_LIFETIME_MS = 110_000;

/** The download (its own 10 s timeout, STORAGE_TIMEOUT_MS) and the PDF parse. */
export const FILE_MS = 15_000;

/** One full analysis call: the model's own timeout (ANALYSIS_TIMEOUT_MS). */
export const MODEL_CALL_MS = 30_000;

/** Settling the unit, the insert and the revalidation, after the model. */
export const SAVE_RESERVE_MS = 5_000;

/** The least an analysis needs once its unit is held. The English retry and the repair run only past this. */
export const MIN_ANALYSIS_MS = FILE_MS + MODEL_CALL_MS + SAVE_RESERVE_MS;

/** How long a retry waits for the first request of its submission, at most. */
export const SUBMISSION_WAIT_MS = 40_000;
export const SUBMISSION_POLL_MS = 1_500;

/** Less than this left and the translation waits for the first view instead. */
export const MIN_TRANSLATION_MS = 8_000;

/** When a retry stops waiting: its own cap, or earlier if waiting longer would leave too little for an analysis. */
export function submissionWaitUntil(now: number, deadline: number): number {
  return Math.min(now + SUBMISSION_WAIT_MS, deadline - MIN_ANALYSIS_MS);
}

/** By when every model call must be over: the save still has its reserve after it. */
export function modelDeadline(deadline: number): number {
  return deadline - SAVE_RESERVE_MS;
}
