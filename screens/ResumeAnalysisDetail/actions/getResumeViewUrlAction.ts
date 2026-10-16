"use server";

import { requireUserId } from "@/lib/auth";
import { fetchResumeKey } from "@/lib/database/resume";
import { NotFoundError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { resumeIdInputSchema } from "@/lib/schemas/resumeSchema";
import { createSignedReadUrl, SIGNED_READ_TTL_SECONDS } from "@/lib/supabase/server";
import type { ActionResult } from "@/types/action";

export type ResumeViewUrl = {
  /** A signed read URL, fresh from this call, valid for `expiresInSeconds`. */
  url: string;
  expiresInSeconds: number;
};

/**
 * A fresh signed URL for the caller's own CV, minted when the drawer opens
 * or a new tab is asked for, not when the page rendered: a page left open
 * past the signature's life still opens the file. `fetchResumeKey` is
 * owner-scoped, so a foreign analysis reads as missing, and so does a row
 * whose object is gone from the bucket.
 */
export async function getResumeViewUrlAction(input: unknown): Promise<ActionResult<ResumeViewUrl>> {
  try {
    await requireUserId();

    const parsed = resumeIdInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid resume id");

    const resumeKey = await fetchResumeKey(parsed.data.resumeId);
    if (!resumeKey) throw new NotFoundError("Resume analysis not found");

    const url = await createSignedReadUrl(resumeKey);
    if (!url) throw new NotFoundError("Resume object not found");

    return { ok: true, data: { url, expiresInSeconds: SIGNED_READ_TTL_SECONDS } };
  } catch (error) {
    return toActionError(error, "Failed to sign a resume view URL");
  }
}
