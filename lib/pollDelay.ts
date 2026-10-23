/**
 * How long to wait before the next status poll, by how long the page has
 * been waiting: quick at first, when the transcript usually lands, then
 * slower, because a long interview's webhook can take minutes and the
 * reconcile fallback is what ends a wait that never resolves.
 */
export const POLL_FAST_MS = 3_000;
export const POLL_MEDIUM_MS = 5_000;
export const POLL_SLOW_MS = 10_000;
/** Fast until here... */
export const POLL_FAST_UNTIL_MS = 30_000;
/** ...medium until here, slow after. */
export const POLL_MEDIUM_UNTIL_MS = 120_000;

/**
 * The poller stops here, counted from the page's mount. By then the
 * reconcile has had its chance many times over; a wait this long is a dead
 * generator or a platform that never finished, and a page that polls forever
 * would hide it.
 */
export const POLL_CEILING_MS = 60 * 60_000;

export function pollDelayMs(elapsedMs: number): number {
  if (elapsedMs < POLL_FAST_UNTIL_MS) return POLL_FAST_MS;
  if (elapsedMs < POLL_MEDIUM_UNTIL_MS) return POLL_MEDIUM_MS;
  return POLL_SLOW_MS;
}

/** How many polls a wait of this length makes, for sizing the cost of waiting. */
export function pollsDuring(waitMs: number): number {
  let elapsed = 0;
  let polls = 0;
  for (;;) {
    elapsed += pollDelayMs(elapsed);
    if (elapsed > waitMs) return polls;
    polls += 1;
  }
}
