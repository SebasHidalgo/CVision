"use server";

import { revalidatePath } from "next/cache";
import { createInterview } from "@/lib/database/interview";
import { fetchResumeById } from "@/lib/database/resume";
import { ensureUser } from "@/lib/database/user";
import { InterviewAttemptLimitError, NotFoundError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { countedAttempts, MAX_INTERVIEW_ATTEMPTS_PER_ANALYSIS } from "@/lib/interviewLimits";
import { liveAttempt } from "@/lib/interviewStatus";
import { createInterviewInputSchema } from "@/lib/schemas/interviewSchema";
import type { ActionResult } from "@/types/action";
import { techstackFromAnalysis } from "../utils/techstack";

/**
 * Starts a mock interview from one of the user's own analyses, or returns the
 * attempt that is still live: one at a time per analysis, up to the
 * provisional cap in total. `fetchResumeById` is already scoped to the
 * owner, so an id from another user resolves to null. No model call: the
 * chips come from the stored analysis.
 */
export async function createInterviewAction(
  input: unknown,
): Promise<ActionResult<{ interviewId: string }>> {
  try {
    // Identity and the account's row, before the interview row points at it.
    await ensureUser();

    const parsed = createInterviewInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid interview input");

    const resume = await fetchResumeById(parsed.data.resumeId);
    if (!resume) throw new NotFoundError("Resume analysis not found");

    // A rehearsal that was never finished is the one to open; the data layer
    // re-checks this and the cap under a transaction, so a race cannot create
    // a second one or a fourth.
    const live = liveAttempt(resume.interviews);
    if (live) return { ok: true, data: { interviewId: live.id } };

    if (countedAttempts(resume.interviews) >= MAX_INTERVIEW_ATTEMPTS_PER_ANALYSIS) {
      throw new InterviewAttemptLimitError();
    }

    const { id: interviewId } = await createInterview({
      role: resume.jobTitle,
      techstack: techstackFromAnalysis(resume.feedback),
      resumeId: resume.id,
      maxAttempts: MAX_INTERVIEW_ATTEMPTS_PER_ANALYSIS,
    });

    revalidatePath("/interviews");
    revalidatePath(`/resume/analysis/${resume.id}`);

    return { ok: true, data: { interviewId } };
  } catch (error) {
    return toActionError(error, "Failed to create interview");
  }
}
