import type { ErrorCode } from "@/lib/error/errors";
import {
  interviewSessionResponseSchema,
  type InterviewSessionResponse,
} from "@/lib/schemas/interviewSessionSchema";

export type SessionRequestResult =
  | { ok: true; data: InterviewSessionResponse }
  | { ok: false; code: ErrorCode };

/**
 * Asks the server for a voice session. The only success is a 2xx whose body
 * is the project's `{ ok: true, data }` with a session inside. Everything
 * else is a failed start: the body's `code` is used when the body parses as
 * `{ ok: false, code }`, and `REQUEST_FAILED` otherwise. Status codes are
 * never interpreted on their own, because the middleware answers a signed-out
 * call with a 404 page rather than a 401.
 */
export async function requestInterviewSession(
  interviewId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionRequestResult> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/interview/${encodeURIComponent(interviewId)}/session`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
  } catch {
    return { ok: false, code: "REQUEST_FAILED" };
  }

  const body = await readJson(response);
  if (!isRecord(body)) return { ok: false, code: "REQUEST_FAILED" };

  if (response.ok && body.ok === true) {
    const session = interviewSessionResponseSchema.safeParse(body.data);
    return session.success
      ? { ok: true, data: session.data }
      : { ok: false, code: "REQUEST_FAILED" };
  }

  if (body.ok === false && typeof body.code === "string" && body.code !== "") {
    // Unknown codes fall through to the generic copy in actionErrorCopy.
    return { ok: false, code: body.code as ErrorCode };
  }

  return { ok: false, code: "REQUEST_FAILED" };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
