/** The only failure detail that crosses the server -> client boundary. */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "AI_UNAVAILABLE"
  | "AI_BAD_FORMAT"
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

export class AiUnavailableError extends AppError {
  constructor(message = "AI provider unavailable", options?: ErrorOptions) {
    super("AI_UNAVAILABLE", message, options);
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
