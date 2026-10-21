import { MAX_RESUME_SIZE_LABEL } from "@/lib/uploadLimits";
import type { ErrorCode, ErrorMeta } from "./errors";

/** User-facing copy per error code. Backend messages are never rendered. */
const COPY: Record<ErrorCode, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again to continue.",
  INVALID_INPUT: "Check the form: some field is missing or invalid.",
  NOT_FOUND: "We couldn't find that item. It may have been deleted.",
  PDF_UNREADABLE:
    "We couldn't open this PDF. It may be damaged or password-protected. Export a fresh copy without a password and upload that.",
  PDF_NO_TEXT:
    "This PDF has too little selectable text to analyze. If it's a scan or an image, export your CV to PDF from Word, Google Docs or similar, so the text can be selected, and upload that.",
  NOT_A_PDF:
    "That file isn't a PDF. Export your CV as a PDF and upload that.",
  FILE_TOO_LARGE: `The file is larger than ${MAX_RESUME_SIZE_LABEL}. Export it again with compressed images and upload that.`,
  UPLOAD_FAILED:
    "The upload didn't go through. Check your connection and try again.",
  STORAGE_UNAVAILABLE:
    "We couldn't save your PDF, so the analysis didn't run. Try again in a few minutes.",
  STORAGE_MISCONFIGURED:
    "File storage is misconfigured on our side. Retrying won't help — please check back later.",
  AI_UNAVAILABLE:
    "The analyzer isn't responding right now. Give it a minute and try again.",
  AI_RATE_LIMITED:
    "The analysis service is busy. Try again in a minute.",
  AI_MISCONFIGURED:
    "The analyzer is misconfigured on our side. Retrying won't help — please check back later.",
  AI_CONTENT_BLOCKED:
    "The analyzer declined to process this content. Remove anything unusual from the CV or job description and try again.",
  AI_BAD_FORMAT:
    "We couldn't read the analysis. Try again — it usually works on a retry.",
  VOICE_UNAVAILABLE:
    "The interviewer couldn't connect right now. Give it a minute and try again.",
  VOICE_MISCONFIGURED:
    "The interview room is misconfigured on our side. Retrying won't help — please check back later.",
  INTERVIEW_NOT_STARTABLE:
    "This interview has already ended. Your feedback will appear under Interviews once it's ready.",
  INTERVIEW_START_LIMIT:
    "This interview has used all of its starts: every connection to the interviewer counts as one. Rehearse again from the analysis.",
  INTERVIEW_CONTEXT_MISSING:
    "This interview has no analysis to build questions from. Run a new analysis and rehearse from there.",
  ANALYSIS_BUSY:
    "An interview for this analysis is in progress. Try again when it ends.",
  ANALYSIS_QUOTA_EXCEEDED:
    "You've used this month's analyses.",
  INTERVIEW_QUOTA_EXCEEDED:
    "Voice interviews are part of Pro.",
  RATE_LIMITED:
    "Too many requests in a short time. Wait a moment and try again.",
  BILLING_UNAVAILABLE:
    "Billing isn't responding right now. Nothing was charged. Give it a minute and try again.",
  BILLING_MISCONFIGURED:
    "Billing is misconfigured on our side. Nothing was charged. Retrying won't help — please check back later.",
  ALREADY_SUBSCRIBED:
    "You already have a Pro subscription. Manage it from your account page.",
  PACK_REQUIRES_PRO:
    "Interview packs are for Pro subscribers. Subscribe to Pro first.",
  NO_BILLING_ACCOUNT:
    "There's no billing account for you yet. It's created with your first purchase.",
  REQUEST_FAILED:
    "The request didn't go through. Check your connection and try again. If it keeps failing, reload the page.",
  UNKNOWN: "Something went wrong on our side. Please try again.",
};

/** "Nov 1", from the ISO date the server put in `meta.resetsAt`. */
export function resetDateCopy(resetsAt: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(resetsAt),
  );
}

/**
 * The copy for a code, with the few blanks `meta` fills: the reset date of
 * a quota, the wait of a rate limit, and the plan, which decides whether a
 * used-up analysis quota is the Free allowance or Pro's fair-use cap.
 */
export function actionErrorCopy(code: ErrorCode, meta?: ErrorMeta): string {
  if (code === "ANALYSIS_QUOTA_EXCEEDED") {
    const reset = meta?.resetsAt ? ` Resets ${resetDateCopy(meta.resetsAt)}.` : "";
    return meta?.plan === "PRO"
      ? `You've reached this month's fair-use limit.${reset}`
      : `You've used this month's analyses.${reset}`;
  }
  if (code === "INTERVIEW_QUOTA_EXCEEDED") {
    if (meta?.plan === "PRO") {
      const reset = meta.resetsAt ? ` They reset ${resetDateCopy(meta.resetsAt)}.` : "";
      return `You've used this period's interviews.${reset}`;
    }
    return COPY.INTERVIEW_QUOTA_EXCEEDED;
  }
  if (code === "RATE_LIMITED" && typeof meta?.retryAfter === "number") {
    const seconds = Math.max(1, Math.ceil(meta.retryAfter));
    const wait = seconds >= 120 ? `${Math.ceil(seconds / 60)} minutes` : seconds >= 60 ? "a minute" : `${seconds} seconds`;
    return `Too many requests in a short time. Try again in ${wait}.`;
  }
  return COPY[code] ?? COPY.UNKNOWN;
}
