"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { FEEDBACK_FAILURE_REASONS, generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import { reopenInterviewForFeedback } from "@/lib/database/interview";
import { InterviewNotStartableError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import type { ActionResult } from "@/types/action";

const inputSchema = z.object({ interviewId: z.uuid() });

/**
 * Retries feedback generation after it gave up. Only the owner's FAILED
 * interview whose transcript is stored qualifies; the reopen is the guard.
 * Runs the generator inline, so the page's maxDuration covers it.
 */
export async function retryInterviewFeedbackAction(
  input: unknown,
): Promise<ActionResult<{ status: "completed" | "pending" }>> {
  try {
    await requireUserId();

    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid retry input");
    const { interviewId } = parsed.data;

    const reopened = await reopenInterviewForFeedback(
      interviewId,
      FEEDBACK_FAILURE_REASONS.feedbackFailed,
    );
    if (!reopened) throw new InterviewNotStartableError("Nothing to retry");

    const outcome = await generateInterviewFeedback(interviewId);
    revalidatePath(`/interview/${interviewId}/feedback`);
    revalidatePath("/interviews");

    switch (outcome.kind) {
      case "completed":
        return { ok: true, data: { status: "completed" } };
      case "skipped":
        return { ok: true, data: { status: "pending" } };
      case "retry-later":
        return { ok: false, code: outcome.code };
      case "failed":
        return { ok: false, code: outcome.code ?? "UNKNOWN" };
    }
  } catch (error) {
    return toActionError(error, "Failed to retry interview feedback");
  }
}
