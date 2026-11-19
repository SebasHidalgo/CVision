"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { deleteAnalysisCascade } from "@/lib/deletion";
import { NotFoundError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { resumeIdInputSchema } from "@/lib/schemas/resumeSchema";
import type { ActionResult } from "@/types/action";

/**
 * Deletes one of the caller's analyses from the list: one whose stored
 * feedback can't be read (its page redirects here, so the list is the only
 * place to delete it). Ownership is the only gate. ANALYSIS_BUSY while a
 * rehearsal of it is live; the cascade is the analysis page's
 * (lib/deletion.ts).
 */
export async function deleteOneAnalysisAction(input: unknown): Promise<ActionResult<{ deleted: true }>> {
  try {
    const userId = await requireUserId();

    const parsed = resumeIdInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid resume id");

    const outcome = await deleteAnalysisCascade({ analysisId: parsed.data.resumeId, userId });
    if (outcome.kind === "not-found") throw new NotFoundError("Resume analysis not found");

    revalidatePath("/resume/analyses");
    revalidatePath("/interviews");

    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return toActionError(error, "Failed to delete the analysis from the list");
  }
}
