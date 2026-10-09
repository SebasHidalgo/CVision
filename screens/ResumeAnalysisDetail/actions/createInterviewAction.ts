"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { createInterview } from "@/lib/database/interview";
import { fetchResumeById } from "@/lib/database/resume";
import { NotFoundError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { createInterviewInputSchema } from "@/lib/schemas/interviewSchema";
import type { ActionResult } from "@/types/action";
import { techstackFromAnalysis } from "../utils/techstack";

/**
 * Starts a mock interview from one of the user's own analyses. `fetchResumeById`
 * is already scoped to the owner, so an id from another user resolves to null.
 * No model call: the chips come from the stored analysis.
 */
export async function createInterviewAction(
  input: unknown,
): Promise<ActionResult<{ interviewId: string }>> {
  try {
    await requireUserId();

    const parsed = createInterviewInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid interview input");

    const resume = await fetchResumeById(parsed.data.resumeId);
    if (!resume) throw new NotFoundError("Resume analysis not found");

    // One interview per analysis (unique in the schema). Hand back the existing
    // one instead of failing on the constraint.
    if (resume.interview) {
      return { ok: true, data: { interviewId: resume.interview.id } };
    }

    const interviewId = await createInterview({
      role: resume.jobTitle,
      techstack: techstackFromAnalysis(resume.feedback),
      resumeId: resume.id,
    });

    revalidatePath("/interviews");

    return { ok: true, data: { interviewId } };
  } catch (error) {
    return toActionError(error, "Failed to create interview");
  }
}
