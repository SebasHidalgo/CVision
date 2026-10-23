"use server";

import { revalidatePath } from "next/cache";
import { analyzeResume } from "@/lib/ai/resumeAnalysis";
import { toGuardStats } from "@/lib/ai/schemas";
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
import { analyzeResumeInputSchema } from "@/lib/schemas/resumeSchema";
import { isResumeKeyOf } from "@/lib/supabase/resumeKey";
import { downloadObject, removeObject } from "@/lib/supabase/server";
import { MAX_RESUME_BYTES } from "@/lib/uploadLimits";
import type { ActionResult } from "@/types/action";

/**
 * Step two of an analysis, after the browser put the CV in storage: session,
 * the key's ownership, rate limit, validation, the quota, and the
 * orchestration (download -> checks -> parse -> AI -> Postgres). The key is
 * trusted for nothing: it has to be under the caller's own prefix, and the
 * bytes behind it are checked as if they had arrived in the request.
 *
 * Only a stored row consumes a unit. The unit is reserved before the
 * download, against an analysis id minted here, and given back on every
 * failure, the user's own file included: a scan or a renamed file never
 * reaches the model, so it costs nothing, and the hourly rate limit is what
 * bounds abuse. And once the key is known to be the caller's, every refusal
 * removes the object: the losing tab at the last analysis of the month, a
 * rate-limited burst, a form that failed validation and the file errors all
 * leave nothing behind in the bucket.
 */
export async function analyzeResumeAction(
  input: unknown,
): Promise<ActionResult<{ resumeId: string }>> {
  let ownedKey: string | null = null;
  let reservation: Reservation | null = null;

  try {
    // Identity and the account's row, before anything that inserts under it.
    const userId = await ensureUser();

    // The key's ownership before anything can refuse: from here on a
    // refusal deletes the object, and only the caller's own object may be
    // deleted. Another user's key is indistinguishable from one that does
    // not exist, and is never downloaded, let alone deleted.
    const namedKey = resumeKeyNamedBy(input);
    if (namedKey !== null && !isResumeKeyOf(namedKey, userId)) {
      throw new NotFoundError("Resume key is not the caller's");
    }
    ownedKey = namedKey;

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

    // The unit, before the download and the model call. The analysis id is
    // minted now so the ledger can name what it paid for.
    const resumeId = crypto.randomUUID();
    reservation = await reserveUsage(userId, "ANALYSIS", resumeId);

    const bytes = await downloadObject(resumeKey);
    if (!bytes) throw new UploadFailedError("No object under the resume key");

    // The bucket limits type and size on the way in; these are the server's
    // own checks on what it actually got, before any parsing is paid for.
    if (!hasPdfHeader(bytes)) throw new NotAPdfError();
    if (bytes.byteLength > MAX_RESUME_BYTES) {
      throw new FileTooLargeError(`Object is ${bytes.byteLength} bytes`);
    }

    // Rejects unreadable and text-less PDFs with their own codes.
    const resumeText = await extractTextFromPDFBytes(bytes);

    const { feedback, guard } = await analyzeResume({
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
      guardStats: toGuardStats(guard),
    });

    // The row points at the object and the unit is spent for good.
    ownedKey = null;
    reservation = null;
    revalidatePath("/resume/analyses");
    revalidatePath("/resume/upload");

    return { ok: true, data: { resumeId } };
  } catch (error) {
    // Drop the file when no record ends up pointing at it. Never throws.
    if (ownedKey) await removeObject(ownedKey);

    const result = toActionError(error, "Failed to analyze resume");
    if (reservation && !result.ok) {
      const { eventId } = reservation;
      await refundUsage(eventId, result.code).catch((refundError) => {
        console.error(`[CVision] refund of ${eventId} failed:`, refundError);
      });
    }
    return result;
  }
}

/** The key the request names, if it names one at all; whose it is, the caller checks. */
function resumeKeyNamedBy(input: unknown): string | null {
  const key = (input as { resumeKey?: unknown } | null)?.resumeKey;
  return typeof key === "string" && key !== "" ? key : null;
}
