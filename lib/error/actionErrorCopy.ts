import type { ErrorCode } from "./errors";

/** User-facing copy per error code. Backend messages are never rendered. */
const COPY: Record<ErrorCode, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again to continue.",
  INVALID_INPUT: "Check the form: some field is missing or invalid.",
  NOT_FOUND: "We couldn't find that item. It may have been deleted.",
  AI_UNAVAILABLE:
    "The analyzer isn't responding right now. Give it a minute and try again.",
  AI_RATE_LIMITED:
    "The analyzer is at capacity right now. Wait a few minutes and try again.",
  AI_MISCONFIGURED:
    "The analyzer is misconfigured on our side. Retrying won't help — please check back later.",
  AI_CONTENT_BLOCKED:
    "The analyzer declined to process this content. Remove anything unusual from the CV or job description and try again.",
  AI_BAD_FORMAT:
    "We couldn't read the analysis. Try again — it usually works on a retry.",
  TRANSCRIPT_TOO_LONG:
    "This interview is too long to score. Try a shorter session.",
  UNKNOWN: "Something went wrong on our side. Please try again.",
};

export function actionErrorCopy(code: ErrorCode): string {
  return COPY[code] ?? COPY.UNKNOWN;
}
