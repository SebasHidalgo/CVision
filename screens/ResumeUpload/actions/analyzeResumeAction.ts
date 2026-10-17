"use server";

import { revalidatePath } from "next/cache";
import { analyzeResume } from "@/lib/ai/resumeAnalysis";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { createResume } from "@/lib/database/resume";
import { refundUsage, reserveUsage, type Reservation } from "@/lib/database/usage";
import { ensureUser } from "@/lib/database/user";
import {
  FileTooLargeError,
  NotAPdfError,
  NotFoundError,
  UploadFailedError,
} from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { extractTextFromPDFBytes, hasPdfHeader } from "@/lib/pdfParse";
import { ANALYSIS_CONSUMING_FAILURE_CODES } from "@/lib/plans";
import { analyzeResumeInputSchema } from "@/lib/schemas/resumeSchema";
import { isResumeKeyOf } from "@/lib/supabase/resumeKey";
import { downloadObject, removeObject } from "@/lib/supabase/server";
import { MAX_RESUME_BYTES } from "@/lib/uploadLimits";
import type { ActionResult } from "@/types/action";

/**
 * Step two of an analysis, after the browser put the CV in storage: session,
 * rate limit, validation, the quota, and the orchestration (download ->
 * checks -> parse -> AI -> Postgres). The key is trusted for nothing: it has
 * to be under the caller's own prefix, and the bytes behind it are checked
 * as if they had arrived in the request. The usage unit is reserved before
 * the download and the model call, against an analysis id minted here, and
 * refunded on any failure that is not the user's input. Once downloaded,
 * the object is removed on any failure, so no file outlives a flow that
 * produced no row.
 */
export async function analyzeResumeAction(
  input: unknown,
): Promise<ActionResult<{ resumeId: string }>> {
  let downloadedKey: string | null = null;
  let reservation: Reservation | null = null;

  try {
    // Identity and the account's row, before anything that inserts under it.
    const userId = await ensureUser();
    await assertRateLimit(userId, "analysis");

    const parsed = analyzeResumeInputSchema.safeParse(input);
    if (!parsed.success) {
      // Failing paths only: the values carry the job description.
      throw new ValidationError(
        `Invalid resume input at: ${parsed.error.issues
          .map((issue) => issue.path.join(".") || "(root)")
          .join(", ")}`,
      );
    }

    const { companyName, jobTitle, jobDescription, resumeKey } = parsed.data;

    // Another user's key is indistinguishable from one that does not exist,
    // and is never downloaded, let alone deleted.
    if (!isResumeKeyOf(resumeKey, userId)) throw new NotFoundError("Resume key is not the caller's");

    // The unit, before the download and the model call. The analysis id is
    // minted now so the ledger can name what it paid for.
    const resumeId = crypto.randomUUID();
    reservation = await reserveUsage(userId, "ANALYSIS", resumeId);

    const bytes = await downloadObject(resumeKey);
    if (!bytes) throw new UploadFailedError("No object under the resume key");
    downloadedKey = resumeKey;

    // The bucket limits type and size on the way in; these are the server's
    // own checks on what it actually got, before any parsing is paid for.
    if (!hasPdfHeader(bytes)) throw new NotAPdfError();
    if (bytes.byteLength > MAX_RESUME_BYTES) {
      throw new FileTooLargeError(`Object is ${bytes.byteLength} bytes`);
    }

    // Rejects unreadable and text-less PDFs with their own codes.
    const resumeText = await extractTextFromPDFBytes(bytes);

    const { feedback } = await analyzeResume({
      jobTitle,
      jobDescription,
      resumeText,
    });

    await createResume({
      id: resumeId,
      companyName,
      jobTitle,
      jobDescription,
      resumeKey,
      feedback,
    });

    downloadedKey = null;
    reservation = null;
    revalidatePath("/resume/analyses");
    revalidatePath("/resume/upload");

    return { ok: true, data: { resumeId } };
  } catch (error) {
    // Drop the file when no record ends up pointing at it.
    if (downloadedKey) await removeObject(downloadedKey);

    const result = toActionError(error, "Failed to analyze resume");
    if (reservation && !result.ok && !ANALYSIS_CONSUMING_FAILURE_CODES.has(result.code)) {
      const { eventId } = reservation;
      await refundUsage(eventId, result.code).catch((refundError) => {
        console.error(`[CVision] refund of ${eventId} failed:`, refundError);
      });
    }
    return result;
  }
}
