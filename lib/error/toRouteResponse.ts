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
  NOT_A_PDF: 400,
  FILE_TOO_LARGE: 413,
  UPLOAD_FAILED: 400,
  INTERVIEW_NOT_STARTABLE: 409,
  INTERVIEW_START_LIMIT: 409,
  INTERVIEW_CONTEXT_MISSING: 409,
  ANALYSIS_BUSY: 409,
  ANALYSIS_QUOTA_EXCEEDED: 403,
  INTERVIEW_QUOTA_EXCEEDED: 403,
  RATE_LIMITED: 429,
  ALREADY_SUBSCRIBED: 409,
  PACK_REQUIRES_PRO: 403,
  NO_BILLING_ACCOUNT: 404,
  VOICE_UNAVAILABLE: 503,
  AI_UNAVAILABLE: 503,
  AI_RATE_LIMITED: 429,
  BILLING_UNAVAILABLE: 503,
  BILLING_PORTAL_UNAVAILABLE: 503,
};

export function routeOk<T>(data: T): NextResponse<ActionResult<T>> {
  return NextResponse.json({ ok: true, data });
}

/** Logs the detail server-side and answers with only the code (and its structured meta). */
export function toRouteError(error: unknown, context: string): NextResponse<ActionResult<never>> {
  console.error(`[CVision] ${context}:`, error);

  const code: ErrorCode = error instanceof AppError ? error.code : "UNKNOWN";
  const meta = error instanceof AppError ? error.meta : undefined;
  const headers: Record<string, string> = {};
  if (typeof meta?.retryAfter === "number") headers["Retry-After"] = String(Math.ceil(meta.retryAfter));

  return NextResponse.json(meta ? { ok: false, code, meta } : { ok: false, code }, {
    status: STATUS_BY_CODE[code] ?? 500,
    headers,
  });
}
