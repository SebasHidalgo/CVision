import type { ErrorCode } from "./errors";

/** User-facing copy per error code. Backend messages are never rendered. */
const COPY: Record<ErrorCode, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again to continue.",
  INVALID_INPUT: "Check the form: some field is missing or invalid.",
  NOT_FOUND: "We couldn't find that item. It may have been deleted.",
  PDF_UNREADABLE:
    "We couldn't open this PDF. It may be damaged or password-protected. Export a fresh copy without a password and upload that.",
  PDF_NO_TEXT:
    "We couldn't find any text in this PDF, so it's probably a scan or an image. Export your CV to PDF from Word, Google Docs or similar, so the text can be selected, and upload that.",
  STORAGE_UNAVAILABLE:
    "We couldn't save your PDF, so the analysis didn't run. Try again in a few minutes.",
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
  TRANSCRIPT_EMPTY:
    "The interview ended before anything was transcribed, so there's nothing to score. Reload the page to start again.",
  INTERVIEW_ALREADY_SCORED:
    "This interview already has its feedback. You'll find it under Interviews.",
  REQUEST_FAILED:
    "The request didn't go through. Check your connection and try again. If it keeps failing, reload the page.",
  UNKNOWN: "Something went wrong on our side. Please try again.",
};

export function actionErrorCopy(code: ErrorCode): string {
  return COPY[code] ?? COPY.UNKNOWN;
}
