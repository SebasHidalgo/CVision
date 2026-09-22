/** The only failure detail that crosses the server -> client boundary. */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PDF_UNREADABLE"
  | "PDF_NO_TEXT"
  | "STORAGE_UNAVAILABLE"
  | "AI_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_MISCONFIGURED"
  | "AI_CONTENT_BLOCKED"
  | "AI_BAD_FORMAT"
  | "TRANSCRIPT_TOO_LONG"
  | "TRANSCRIPT_EMPTY"
  | "INTERVIEW_ALREADY_SCORED"
  // Client-side only: the Action call itself rejected (network, platform 413
  // or 504, stale deployment), so no server code exists to report.
  | "REQUEST_FAILED"
  | "UNKNOWN";

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
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

/** The PDF opened but has no text layer, as with a scan or an image export. */
export class PdfNoTextError extends AppError {
  constructor(message = "PDF has no extractable text") {
    super("PDF_NO_TEXT", message);
  }
}

export class StorageUnavailableError extends AppError {
  constructor(message = "File storage failed") {
    super("STORAGE_UNAVAILABLE", message);
  }
}

export class TranscriptTooLongError extends AppError {
  constructor(message = "Transcript exceeds the length limits") {
    super("TRANSCRIPT_TOO_LONG", message);
  }
}

/** The call ended before anything was transcribed. */
export class TranscriptEmptyError extends AppError {
  constructor(message = "Transcript is empty") {
    super("TRANSCRIPT_EMPTY", message);
  }
}

/** Feedback already exists. The room redirects first, so this is a double submit. */
export class InterviewAlreadyScoredError extends AppError {
  constructor(message = "Interview already has feedback") {
    super("INTERVIEW_ALREADY_SCORED", message);
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
