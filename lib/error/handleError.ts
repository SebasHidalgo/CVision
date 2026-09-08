import { AppError } from "./errors";

/**
 * Next signals redirect(), notFound() and the dynamic-render bailout by
 * throwing. Those are control flow, not failures, and must pass through.
 */
function isFrameworkControlFlow(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;

  return (
    digest === "DYNAMIC_SERVER_USAGE" ||
    digest === "NEXT_NOT_FOUND" ||
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  );
}

/**
 * Logs the detail server-side and rethrows typed: `AppError` keeps its code,
 * anything else collapses to UNKNOWN so its message never reaches the client.
 *
 * Declared as a `function` so TS narrows calls as unreachable and callers
 * aren't widened to `T | undefined`.
 */
export function handleError(error: unknown, fallbackMessage: string): never {
  if (isFrameworkControlFlow(error)) throw error;

  console.error(`[CVision] ${fallbackMessage}:`, error);

  if (error instanceof AppError) throw error;

  throw new AppError("UNKNOWN", fallbackMessage, { cause: error });
}
