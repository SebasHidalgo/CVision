"use server";

import { revalidatePath } from "next/cache";
import { createInterview } from "@/lib/database/interview";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { fetchResumeById } from "@/lib/database/resume";
import { usageSummary } from "@/lib/database/usage";
import { ensureUser } from "@/lib/database/user";
import { InterviewQuotaExceededError, NotFoundError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { liveAttempt } from "@/lib/interviewStatus";
import { createInterviewInputSchema } from "@/lib/schemas/interviewSchema";
import type { ActionResult } from "@/types/action";
import { techstackFromAnalysis } from "../utils/techstack";

/**
 * Starts a mock interview from one of the user's own analyses, or returns the
 * attempt that is still live: one at a time per analysis. The plan's
 * interview unit is not reserved here (the first token does that) but it is
 * checked, so a user with none left is told now rather than in the room.
 * `fetchResumeById` is already scoped to the owner, so an id from another
 * user resolves to null. No model call: the chips come from the stored
 * analysis.
 */
export async function createInterviewAction(
  input: unknown,
): Promise<ActionResult<{ interviewId: string }>> {
  try {
    // Identity and the account's row, before the interview row points at it.
    const userId = await ensureUser();
    await assertRateLimit(userId, "interviewCreate");

    const parsed = createInterviewInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid interview input");

    const resume = await fetchResumeById(parsed.data.resumeId);
    if (!resume) throw new NotFoundError("Resume analysis not found");

    // A rehearsal that was never finished is the one to open; the data layer
    // re-checks this under a transaction, so a race cannot create a second.
    const live = liveAttempt(resume.interviews);
    if (live) return { ok: true, data: { interviewId: live.id } };

    const usage = await usageSummary(userId);
    const hasUnit = usage.plan === "FREE" ? usage.trial.available : usage.interviews.left > 0;
    if (!hasUnit) {
      throw new InterviewQuotaExceededError({
        plan: usage.plan,
        ...(usage.plan === "PRO" ? { resetsAt: usage.resetsAt.toISOString() } : {}),
      });
    }

    const { id: interviewId } = await createInterview({
      role: resume.jobTitle,
      techstack: techstackFromAnalysis(resume.feedback),
      resumeId: resume.id,
    });

    revalidatePath("/interviews");
    revalidatePath(`/resume/analysis/${resume.id}`);

    return { ok: true, data: { interviewId } };
  } catch (error) {
    return toActionError(error, "Failed to create interview");
  }
}
