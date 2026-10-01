"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { analyzeResume } from "@/lib/ai/resumeAnalysis";
import { createResume } from "@/lib/database/resume";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { extractTextFromPDFFile } from "@/lib/pdfParse";
import { createResumeInputSchema } from "@/lib/schemas/resumeSchema";
import {
  buildResumeKey,
  removeFileFromSupabase,
  uploadFileToSupabase,
} from "@/lib/supabase";
import type { ActionResult } from "@/types/action";

/**
 * Public boundary for resume analysis: session, validation and orchestration
 * (PDF -> storage -> AI -> Postgres). Keeps the data layer as pure persistence.
 */
export async function analyzeResumeAction(
  formData: FormData,
): Promise<ActionResult<{ resumeId: string }>> {
  let uploadedKey: string | null = null;

  try {
    const userId = await requireUserId();

    const parsed = createResumeInputSchema.safeParse({
      companyName: formData.get("companyName"),
      jobTitle: formData.get("jobTitle"),
      jobDescription: formData.get("jobDescription"),
      resume: formData.get("resume"),
    });

    if (!parsed.success) {
      // Failing paths only: the values carry the resume and job description.
      throw new ValidationError(
        `Invalid resume input at: ${parsed.error.issues
          .map((issue) => issue.path.join(".") || "(root)")
          .join(", ")}`,
      );
    }

    const { companyName, jobTitle, jobDescription, resume } = parsed.data;

    // Rejects unreadable and text-less PDFs with their own codes.
    const resumeText = await extractTextFromPDFFile(resume);

    // Upload before inference so a storage failure doesn't waste the model run.
    uploadedKey = buildResumeKey(userId);
    const resumeUrl = await uploadFileToSupabase(resume, uploadedKey);

    const feedback = await analyzeResume({
      jobTitle,
      jobDescription,
      resumeText,
    });

    const resumeId = await createResume({
      companyName,
      jobTitle,
      jobDescription,
      resumeUrl,
      feedback,
    });

    uploadedKey = null;
    revalidatePath("/resume/analyses");

    return { ok: true, data: { resumeId } };
  } catch (error) {
    // Drop the file when no record ends up pointing at it.
    if (uploadedKey) await removeFileFromSupabase(uploadedKey);

    return toActionError(error, "Failed to analyze resume");
  }
}
