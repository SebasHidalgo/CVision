"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { extractTechstackFromDescription } from "@/lib/ai/techstack";
import { createInterview } from "@/lib/database/interview";
import { fetchResumeById } from "@/lib/database/resume";
import {
  AiFormatError,
  AiUnavailableError,
  NotFoundError,
} from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { createInterviewInputSchema } from "@/lib/schemas/interviewSchema";
import type { ActionResult } from "@/types/action";

/**
 * Starts a mock interview from one of the user's own analyses. `fetchResumeById`
 * is already scoped to the owner, so an id from another user resolves to null.
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
    // one instead of paying for extraction and then failing on the constraint.
    if (resume.interview) {
      return { ok: true, data: { interviewId: resume.interview.id } };
    }

    const techstack = await extractTechstackOrEmpty(resume.jobDescription);

    const interviewId = await createInterview({
      role: resume.jobTitle,
      techstack,
      resumeId: resume.id,
    });

    revalidatePath("/interviews");

    return { ok: true, data: { interviewId } };
  } catch (error) {
    return toActionError(error, "Failed to create interview");
  }
}

/** The techstack only feeds display chips, so an AI failure must not block. */
async function extractTechstackOrEmpty(description: string): Promise<string[]> {
  try {
    return await extractTechstackFromDescription(description);
  } catch (error) {
    if (
      !(error instanceof AiUnavailableError || error instanceof AiFormatError)
    ) {
      throw error;
    }
    console.warn(`[CVision] Techstack extraction skipped: ${error.code}`);
    return [];
  }
}
