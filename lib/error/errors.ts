/** The only failure detail that crosses the server -> client boundary. */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "AI_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_MISCONFIGURED"
  | "AI_CONTENT_BLOCKED"
  | "AI_BAD_FORMAT"
  | "TRANSCRIPT_TOO_LONG"
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

export class TranscriptTooLongError extends AppError {
  constructor(message = "Transcript exceeds the length limits") {
    super("TRANSCRIPT_TOO_LONG", message);
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
