/** The only failure detail that crosses the server -> client boundary. */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PDF_UNREADABLE"
  | "PDF_NO_TEXT"
  // The upload, which goes from the browser straight to storage.
  | "NOT_A_PDF"
  | "FILE_TOO_LARGE"
  | "UPLOAD_FAILED"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_MISCONFIGURED"
  | "AI_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_MISCONFIGURED"
  | "AI_CONTENT_BLOCKED"
  | "AI_BAD_FORMAT"
  // Voice session (ElevenLabs): the interview room's equivalent of AI_*.
  | "VOICE_UNAVAILABLE"
  | "VOICE_MISCONFIGURED"
  // Interview state at session start.
  | "INTERVIEW_NOT_STARTABLE"
  | "INTERVIEW_START_LIMIT"
  | "INTERVIEW_CONTEXT_MISSING"
  // Deleting an analysis while a rehearsal of it is live or being scored.
  | "ANALYSIS_BUSY"
  // Plans and limits (lib/plans.ts).
  | "ANALYSIS_QUOTA_EXCEEDED"
  | "INTERVIEW_QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  // Client-side only: the Action call itself rejected (network, platform 413
  // or 504, stale deployment), so no server code exists to report.
  | "REQUEST_FAILED"
  | "UNKNOWN";

/**
 * Structured facts a few codes carry to the client beside the code: never
 * free text. The copy is still chosen client-side from the code; these
 * fill its blanks (when the quota resets, how long to wait, which plan).
 */
export type ErrorMeta = {
  /** ISO date when the period's quota comes back; absent for a lifetime quota. */
  resetsAt?: string;
  /** Seconds until a rate-limited request may be retried. */
  retryAfter?: number;
  plan?: "FREE" | "PRO";
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly meta?: ErrorMeta;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions & { meta?: ErrorMeta }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    if (options?.meta) this.meta = options.meta;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Not authenticated") {
    super("UNAUTHORIZED", message);
  }
}

/** Also used when the resource exists but belongs to another user. */
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", message);
  }
}

/** pdf.js could not open the file: corrupt, truncated or password-protected. */
export class PdfUnreadableError extends AppError {
  constructor(message = "PDF could not be parsed") {
    super("PDF_UNREADABLE", message);
  }
}

/** The PDF opened but has too little text to be a CV, as with a scan. */
export class PdfNoTextError extends AppError {
  constructor(message = "PDF has no extractable text") {
    super("PDF_NO_TEXT", message);
  }
}

/** The uploaded bytes do not start as a PDF does: a renamed file, not a damaged one. */
export class NotAPdfError extends AppError {
  constructor(message = "Uploaded file is not a PDF") {
    super("NOT_A_PDF", message);
  }
}

/** The object in storage is over the limit the form and the bucket enforce. */
export class FileTooLargeError extends AppError {
  constructor(message = "Uploaded file exceeds the size limit") {
    super("FILE_TOO_LARGE", message);
  }
}

/**
 * The browser's PUT to storage failed, or the action was asked to analyze
 * a key no object sits under: the upload did not go through.
 */
export class UploadFailedError extends AppError {
  constructor(message = "Upload did not complete") {
    super("UPLOAD_FAILED", message);
  }
}

export class StorageUnavailableError extends AppError {
  constructor(message = "File storage failed") {
    super("STORAGE_UNAVAILABLE", message);
  }
}

/** Missing URL or service role: an operator problem no retry fixes. */
export class StorageMisconfiguredError extends AppError {
  constructor(message = "File storage misconfigured") {
    super("STORAGE_MISCONFIGURED", message);
  }
}

/** Provider down, network failure or timeout: retrying soon can work. */
export class AiUnavailableError extends AppError {
  constructor(message = "AI provider unavailable", options?: ErrorOptions) {
    super("AI_UNAVAILABLE", message, options);
  }
}

/** Rate limit or quota hit: retryable, but not within seconds. */
export class AiRateLimitedError extends AppError {
  constructor(message = "AI provider rate limited", options?: ErrorOptions) {
    super("AI_RATE_LIMITED", message, options);
  }
}

/**
 * Bad or missing credentials, unknown model, malformed request: an operator
 * problem that no amount of user retries will fix.
 */
export class AiMisconfiguredError extends AppError {
  constructor(message = "AI provider misconfigured", options?: ErrorOptions) {
    super("AI_MISCONFIGURED", message, options);
  }
}

/** The provider refused the content on safety grounds. Not a format problem. */
export class AiContentBlockedError extends AppError {
  constructor(message = "AI provider blocked the content", options?: ErrorOptions) {
    super("AI_CONTENT_BLOCKED", message, options);
  }
}

export class AiFormatError extends AppError {
  constructor(
    message = "AI response did not match the expected schema",
    options?: ErrorOptions,
  ) {
    super("AI_BAD_FORMAT", message, options);
  }
}

/** The voice platform did not answer, timed out or failed: try again shortly. */
export class VoiceUnavailableError extends AppError {
  constructor(message = "Voice platform unavailable", options?: ErrorOptions) {
    super("VOICE_UNAVAILABLE", message, options);
  }
}

/** Missing key or agent id, or the platform rejected our request: operator problem. */
export class VoiceMisconfiguredError extends AppError {
  constructor(message = "Voice platform misconfigured", options?: ErrorOptions) {
    super("VOICE_MISCONFIGURED", message, options);
  }
}

/** The interview is past the point where a session can be issued. */
export class InterviewNotStartableError extends AppError {
  constructor(message = "Interview cannot be started in its current state") {
    super("INTERVIEW_NOT_STARTABLE", message);
  }
}

/** Every start is a paid call; this interview has used its allowance. */
export class InterviewStartLimitError extends AppError {
  constructor(message = "Interview start limit reached") {
    super("INTERVIEW_START_LIMIT", message);
  }
}

/** A rehearsal of the analysis is in a call or being scored: it cannot vanish under it. */
export class AnalysisBusyError extends AppError {
  constructor(message = "An interview of this analysis is in progress") {
    super("ANALYSIS_BUSY", message);
  }
}

/** The period's analyses are used up; `meta.resetsAt` says when they come back. */
export class AnalysisQuotaExceededError extends AppError {
  constructor(meta: ErrorMeta, message = "Analysis quota exceeded for the period") {
    super("ANALYSIS_QUOTA_EXCEEDED", message, { meta });
  }
}

/**
 * No interview may be reserved: the period's full interviews are used, or
 * the free trial already was (then `meta.plan` is FREE and there is no reset).
 */
export class InterviewQuotaExceededError extends AppError {
  constructor(meta: ErrorMeta, message = "Interview quota exceeded") {
    super("INTERVIEW_QUOTA_EXCEEDED", message, { meta });
  }
}

/** Too many requests of one kind in the window; `meta.retryAfter` is in seconds. */
export class RateLimitedError extends AppError {
  constructor(retryAfter: number, message = "Rate limit exceeded") {
    super("RATE_LIMITED", message, { meta: { retryAfter } });
  }
}

/** The interview has no analysis to build the interviewer's context from. */
export class InterviewContextMissingError extends AppError {
  constructor(message = "Interview has no analysis context") {
    super("INTERVIEW_CONTEXT_MISSING", message);
  }
}
