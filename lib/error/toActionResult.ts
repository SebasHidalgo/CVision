import { AppError } from "./errors";
import type { ActionResult } from "@/types/action";

/**
 * Standard catch for a Server Action: logs server-side and returns only a code
 * to the client.
 */
export function toActionError(
  error: unknown,
  context: string
): ActionResult<never> {
  // Next control-flow errors are signals, not failures.
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_")) throw error;

  console.error(`[CVision] ${context}:`, error);

  if (error instanceof AppError) return { ok: false, code: error.code };
  return { ok: false, code: "UNKNOWN" };
}
