"use server";

import { revalidatePath } from "next/cache";
import { translateAnalysis } from "@/lib/ai/contentTranslation";
import { analyzeResume } from "@/lib/ai/resumeAnalysis";
import { toGuardStats } from "@/lib/ai/schemas";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { createResume, fetchResumeKey } from "@/lib/database/resume";
import { refundUsage, reserveAnalysis, settleAnalysisUnit, type Reservation } from "@/lib/database/usage";
import { ensureUser } from "@/lib/database/user";
import {
  AnalysisInProgressError,
  FileTooLargeError,
  NotAPdfError,
  NotFoundError,
  UploadFailedError,
} from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { getLocale } from "@/lib/i18n/server";
import { extractPdfText, hasPdfHeader } from "@/lib/pdfParse";
import { analyzeResumeInputSchema } from "@/lib/schemas/resumeSchema";
import { isResumeKeyOf } from "@/lib/supabase/resumeKey";
import { downloadObject, removeObject } from "@/lib/supabase/server";
import { MAX_RESUME_BYTES } from "@/lib/uploadLimits";
import { analysisIdFor } from "@/screens/ResumeUpload/utils/analysisId";
import {
  ACTION_BUDGET_MS,
  MIN_TRANSLATION_MS,
  modelDeadline,
  REQUEST_LIFETIME_MS,
  SUBMISSION_POLL_MS,
  submissionWaitUntil,
} from "@/screens/ResumeUpload/utils/budget";
import type { ActionResult } from "@/types/action";

/**
 * Step two of an analysis, after the browser put the CV in storage: session,
 * the key's ownership, rate limit, validation, the quota, and the
 * orchestration (download -> checks -> parse -> AI -> Postgres). The key is
 * trusted for nothing: it has to be under the caller's own prefix, and the
 * bytes behind it are checked as if they had arrived in the request.
 *
 * Only a stored row consumes a unit. The unit is reserved before the
 * download, against the analysis id the submission names, and given back on every
 * failure, the user's own file included: a scan or a renamed file never
 * reaches the model, so it costs nothing, and the hourly rate limit is what
 * bounds abuse. And once the key is known to be the caller's, every refusal
 * removes the object: the losing tab at the last analysis of the month, a
 * rate-limited burst, a form that failed validation and the file errors all
 * leave nothing behind in the bucket.
 *
 * A submission is named by the key the form minted for it and resends on a
 * retry, and the analysis id is derived from it. A retry whose first request
 * saved the analysis (its response lost on the way back) gets that analysis:
 * no unit, no model call, and its own upload removed. A retry that arrives
 * while the first request still holds its unit waits for that request's row.
 * Two requests that both reach the insert (only after the first outlived
 * `REQUEST_LIFETIME_MS`) collide on the primary key: the loser gives its
 * unit back and answers with the winner's analysis.
 *
 * The unit is settled (spent for good) right before the insert, and only if
 * it is still held: a unit the abandoned-request sweep or a retry already gave
 * back is never saved under. The time budget (utils/budget.ts) bounds the
 * wait and hands the model a deadline, so a retry that waited still fits the
 * page's maxDuration: its optional steps are skipped, not its analysis.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function analyzeResumeAction(
  input: unknown,
): Promise<ActionResult<{ resumeId: string }>> {
  const deadline = Date.now() + ACTION_BUDGET_MS;
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

    const { companyName, jobTitle, jobDescription, resumeKey, submissionKey } = parsed.data;

    // The analysis this submission names, so the ledger can name what it paid
    // for and a retry of the submission names the same one.
    const resumeId = analysisIdFor(userId, submissionKey);

    // The unit, before the download and the model call; or the analysis an
    // earlier request for this submission saved, or is about to.
    const waitUntil = submissionWaitUntil(Date.now(), deadline);
    for (;;) {
      const savedKey = await fetchResumeKey(resumeId);
      if (savedKey !== null) {
        await dropDuplicateUpload(resumeKey, savedKey);
        ownedKey = null;
        return { ok: true, data: { resumeId } };
      }
      const outcome = await reserveAnalysis(userId, resumeId, REQUEST_LIFETIME_MS);
      if (outcome.kind === "reserved") {
        reservation = outcome;
        break;
      }
      if (Date.now() + SUBMISSION_POLL_MS > waitUntil) throw new AnalysisInProgressError();
      await sleep(SUBMISSION_POLL_MS);
    }

    const bytes = await downloadObject(resumeKey);
    if (!bytes) throw new UploadFailedError("No object under the resume key");

    // The bucket limits type and size on the way in; these are the server's
    // own checks on what it actually got, before any parsing is paid for.
    if (!hasPdfHeader(bytes)) throw new NotAPdfError();
    if (bytes.byteLength > MAX_RESUME_BYTES) {
      throw new FileTooLargeError(`Object is ${bytes.byteLength} bytes`);
    }

    // Rejects unreadable and text-less PDFs with their own codes.
    const { text: resumeText, accentsComposed } = await extractPdfText(bytes);

    const { feedback, guard } = await analyzeResume({
      jobTitle,
      jobDescription,
      resumeText,
      accentsComposed,
      logId: resumeId,
      deadline: modelDeadline(deadline),
    });

    // Spent for good from here, unless it was given back meanwhile: then nothing is saved under it.
    if (!(await settleAnalysisUnit(reservation.eventId))) {
      throw new Error(`Analysis unit ${reservation.eventId} is no longer held; not saving under it`);
    }

    try {
      await createResume({
        id: resumeId,
        companyName,
        jobTitle,
        jobDescription,
        resumeKey,
        feedback,
        guardStats: toGuardStats(guard),
      });
    } catch (error) {
      // The insert failed as a whole; a row under this id now can only be another request's for this submission.
      const winnerKey = await fetchResumeKey(resumeId).catch(() => null);
      if (winnerKey === null) throw error;
      const { eventId } = reservation;
      reservation = null;
      await refundUsage(eventId, "DUPLICATE_SUBMISSION").catch((refundError) => {
        console.error(`[CVision] refund of ${eventId} failed:`, refundError);
      });
      await dropDuplicateUpload(resumeKey, winnerKey);
      ownedKey = null;
      console.warn(`[CVision] analysis ${resumeId}: a duplicate request of the submission lost the insert; unit returned`);
      return { ok: true, data: { resumeId } };
    }

    // The row points at the object and the unit is spent for good.
    ownedKey = null;
    reservation = null;
    revalidatePath("/resume/analyses");
    revalidatePath("/resume/upload");

    // A Spanish interface reads the analysis in Spanish on its first view: translated now, once.
    // The analysis is saved and charged already; a failed translation only means the page translates on view.
    try {
      const locale = await getLocale();
      if (locale !== "en" && deadline - Date.now() >= MIN_TRANSLATION_MS) {
        await translateAnalysis(userId, { id: resumeId, companyName, jobTitle, feedback }, locale, deadline);
      }
    } catch (error) {
      console.warn(`[CVision][i18n] translation at creation skipped for ${resumeId}: ${error instanceof Error ? error.name : "unknown"}`);
    }

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

/** The upload of a retry whose analysis is already saved: removed, unless the saved row points at that same object. */
async function dropDuplicateUpload(uploadedKey: string, savedKey: string): Promise<void> {
  if (uploadedKey !== savedKey) await removeObject(uploadedKey);
}

/** The key the request names, if it names one at all; whose it is, the caller checks. */
function resumeKeyNamedBy(input: unknown): string | null {
  const key = (input as { resumeKey?: unknown } | null)?.resumeKey;
  return typeof key === "string" && key !== "" ? key : null;
}
