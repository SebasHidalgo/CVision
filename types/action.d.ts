import type { ErrorCode, ErrorMeta } from "@/lib/error/errors";

/**
 * Return contract for every Server Action. The failure carries the code
 * and, for a few codes, structured facts the copy needs (a reset date, a
 * retry delay, the plan); never a message.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; meta?: ErrorMeta };
