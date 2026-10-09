import { NextResponse } from "next/server";
import type { ActionResult } from "@/types/action";
import { AppError, type ErrorCode } from "./errors";

/**
 * Route Handler counterpart of `toActionError`: the same `ActionResult`
 * body, so the client translates it with `actionErrorCopy`, plus an HTTP
 * status for the code. Codes not listed are server-side faults.
 */
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  INTERVIEW_NOT_STARTABLE: 409,
  INTERVIEW_START_LIMIT: 409,
  INTERVIEW_CONTEXT_MISSING: 409,
  INTERVIEW_ALREADY_SCORED: 409,
  VOICE_UNAVAILABLE: 503,
  AI_UNAVAILABLE: 503,
  AI_RATE_LIMITED: 429,
};

export function routeOk<T>(data: T): NextResponse<ActionResult<T>> {
  return NextResponse.json({ ok: true, data });
}

/** Logs the detail server-side and answers with only the code. */
export function toRouteError(error: unknown, context: string): NextResponse<ActionResult<never>> {
  console.error(`[CVision] ${context}:`, error);

  const code: ErrorCode = error instanceof AppError ? error.code : "UNKNOWN";
  return NextResponse.json({ ok: false, code }, { status: STATUS_BY_CODE[code] ?? 500 });
}
