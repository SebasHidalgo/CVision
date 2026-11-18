"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { fetchHiddenResumes } from "@/lib/database/resume";
import { deleteAnalysisCascade } from "@/lib/deletion";
import { AnalysisBusyError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import type { ActionResult } from "@/types/action";

/** Far above any Free history (3 analyses a month); keeps the body small. */
const MAX_IDS = 1000;
/** Stop starting new deletions after this, well inside the page's maxDuration, and say how many are left. */
const DELETE_BUDGET_MS = 40_000;

const inputSchema = z.object({ ids: z.array(z.uuid()).min(1).max(MAX_IDS) });

export type HiddenDeletion = {
  deleted: number;
  /** Not deleted: a rehearsal of it is in a call or being scored. */
  busy: number;
  /** Not deleted: the database or the cascade failed (logged with the id). */
  failed: number;
  /** Not attempted: the time budget ran out; deleting again finishes them. */
  remaining: number;
};

/**
 * Deletes the caller's hidden analyses, one cascade each (lib/deletion.ts).
 * The set is read again here, now: the ids the page showed only narrow it,
 * so a hidden analysis the user never saw (one pushed out of the last three
 * since the page loaded) is not taken, and one that became visible since is
 * kept. Ids that aren't the caller's never match. Sequential: each cascade
 * is a serializable transaction, and running them side by side would only
 * trade speed for serialization failures. A busy or failed one doesn't stop
 * the rest; the counts say what happened.
 */
export async function deleteHiddenAnalysesAction(input: unknown): Promise<ActionResult<HiddenDeletion>> {
  try {
    const userId = await requireUserId();

    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid hidden analysis ids");

    const confirmed = new Set(parsed.data.ids);
    const targets = (await fetchHiddenResumes()).filter((analysis) => confirmed.has(analysis.id));

    const started = Date.now();
    const result: HiddenDeletion = { deleted: 0, busy: 0, failed: 0, remaining: 0 };
    for (const [at, analysis] of targets.entries()) {
      if (Date.now() - started > DELETE_BUDGET_MS) {
        result.remaining = targets.length - at;
        break;
      }
      try {
        const outcome = await deleteAnalysisCascade({ analysisId: analysis.id, userId });
        // "not-found": gone already (another tab); nothing to report.
        if (outcome.kind === "deleted") result.deleted += 1;
      } catch (error) {
        if (error instanceof AnalysisBusyError) {
          result.busy += 1;
        } else {
          result.failed += 1;
          console.error(`[CVision][deletion] hidden analysis=${analysis.id} not deleted:`, error instanceof Error ? error.name : error);
        }
      }
    }

    revalidatePath("/resume/analyses");
    revalidatePath("/interviews");

    return { ok: true, data: result };
  } catch (error) {
    return toActionError(error, "Failed to delete the hidden analyses");
  }
}
