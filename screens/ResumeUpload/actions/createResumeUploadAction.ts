"use server";

import { assertRateLimit } from "@/lib/database/rateLimit";
import { usageSummary } from "@/lib/database/usage";
import { ensureUser } from "@/lib/database/user";
import { AnalysisQuotaExceededError } from "@/lib/error/errors";
import { toActionError } from "@/lib/error/toActionResult";
import { buildResumeKey } from "@/lib/supabase/resumeKey";
import { createSignedUploadUrl } from "@/lib/supabase/server";
import type { ActionResult } from "@/types/action";

export type ResumeUpload = {
  /** Where the file will live; the analysis action is called with this. */
  resumeKey: string;
  /** Single use. The browser PUTs the PDF here with no key of any kind. */
  uploadUrl: string;
};

/**
 * Step one of an analysis: a place in storage for the CV, under the caller's
 * own prefix, and a signed URL to put it there. The file never passes
 * through a server function. A user with no analysis left this period gets
 * no URL (checked, not reserved: the unit is taken by the analysis action).
 * An upload that is never followed by the analysis action leaves an object
 * with no row; the collector removes those after a day.
 */
export async function createResumeUploadAction(): Promise<ActionResult<ResumeUpload>> {
  try {
    // The account's row has to exist before the analysis row can point at it.
    const userId = await ensureUser();
    await assertRateLimit(userId, "uploadUrl");

    const usage = await usageSummary(userId);
    if (usage.analyses.left === 0) {
      throw new AnalysisQuotaExceededError({ plan: usage.plan, resetsAt: usage.resetsAt.toISOString() });
    }

    const resumeKey = buildResumeKey(userId);
    const uploadUrl = await createSignedUploadUrl(resumeKey);

    return { ok: true, data: { resumeKey, uploadUrl } };
  } catch (error) {
    return toActionError(error, "Failed to prepare a resume upload");
  }
}
