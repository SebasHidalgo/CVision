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
 * Opens the interview room of one of the user's own analyses: the live one
 * when there is one (a room never started, or a started one that can go
 * on), otherwise a new room. One at a time per analysis. A room costs
 * nothing until its Start: the plan's interview unit is not reserved here
 * (the first token does that) but it is checked, so a user with none left
 * is told now rather than in the room; a room never started is not listed
 * or counted, and the daily sweep deletes it after three days.
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

    const parsed = createInterviewInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid interview input");

    const resume = await fetchResumeById(parsed.data.resumeId);
    if (!resume) throw new NotFoundError("Resume analysis not found");

    // A room that is still live is the one to open, and reopening it creates nothing, so it costs no rate-limit
    // count; the data layer re-checks this under a transaction, so a race cannot create a second.
    const live = resume.unstartedRoom ?? liveAttempt(resume.interviews);
    if (live) return { ok: true, data: { interviewId: live.id } };

    // Only a new row counts against the creation limit.
    await assertRateLimit(userId, "interviewCreate");

    // The same decision the first token will make (lib/interviewEntitlement),
    // on the same facts: this only spares a row nobody could start.
    const { entitlement } = await usageSummary(userId);
    if (entitlement.source === "none") {
      throw new InterviewQuotaExceededError({
        plan: entitlement.plan,
        ...(entitlement.resetsAt ? { resetsAt: entitlement.resetsAt } : {}),
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
