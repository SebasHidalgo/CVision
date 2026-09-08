import type { ErrorCode } from "@/lib/error/errors";

/** Return contract for every Server Action. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode };
