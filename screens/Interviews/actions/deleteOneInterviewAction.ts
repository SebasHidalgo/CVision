"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { deleteInterviewCascade } from "@/lib/deletion";
import { NotFoundError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import type { ActionResult } from "@/types/action";

const inputSchema = z.object({ interviewId: z.uuid() });

/**
 * Deletes one of the caller's interviews from the list: a hidden one (its analysis is beyond the plan's history, so
 * its room and feedback page don't open and the list is the only place to delete it). Ownership is the only gate, as
 * for an analysis: the history hides, it never protects a user's own interview from that user. ANALYSIS_BUSY while it
 * is in a call or being scored; the cascade is lib/deletion.ts's (rows first, then its conversations on the platform).
 */
export async function deleteOneInterviewAction(input: unknown): Promise<ActionResult<{ deleted: true }>> {
  try {
    const userId = await requireUserId();

    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid interview id");

    const outcome = await deleteInterviewCascade({ interviewId: parsed.data.interviewId, userId });
    if (outcome.kind === "not-found") throw new NotFoundError("Interview not found");

    revalidatePath("/interviews");
    revalidatePath("/resume/analyses");

    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return toActionError(error, "Failed to delete the interview from the list");
  }
}
