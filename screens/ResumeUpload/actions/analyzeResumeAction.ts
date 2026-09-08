"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { generateJson } from "@/lib/ai/client";
import { resumeAnalysisPrompt } from "@/lib/ai/prompts/cv-analysis.prompt";
import { createResume } from "@/lib/database/resume";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { extractTextFromPDFFile } from "@/lib/pdfParse";
import {
  createResumeInputSchema,
  resumeFeedbackSchema,
} from "@/lib/schemas/resumeSchema";
import {
  buildResumeKey,
  removeFileFromSupabase,
  uploadFileToSupabase,
} from "@/lib/supabase";
import type { ActionResult } from "@/types/action";

const MAX_RESUME_TEXT_CHARS = 20_000;
const ANALYSIS_TIMEOUT_MS = 90_000;

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

    const resumeText = (await extractTextFromPDFFile(resume)).slice(
      0,
      MAX_RESUME_TEXT_CHARS,
    );

    if (!resumeText.trim()) {
      // Scanned PDF with no text layer: the model would invent feedback.
      throw new ValidationError("The PDF has no extractable text");
    }

    // Upload before inference so a storage failure doesn't waste the model run.
    uploadedKey = buildResumeKey(userId);
    const resumeUrl = await uploadFileToSupabase(resume, uploadedKey);

    const feedback = await generateJson({
      provider: "ollama",
      prompt: resumeAnalysisPrompt({ jobTitle, jobDescription, resumeText }),
      schema: resumeFeedbackSchema,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
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
