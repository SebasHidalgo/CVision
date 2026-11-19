"use server";

import { requireUserId } from "@/lib/auth";
import { translateAnalysis, type TranslationOutcome } from "@/lib/ai/contentTranslation";
import { fetchResumeById } from "@/lib/database/resume";
import { NotFoundError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { getLocale } from "@/lib/i18n/server";
import { resumeIdInputSchema } from "@/lib/schemas/resumeSchema";
import type { ActionResult } from "@/types/action";

// The analysis page's maxDuration (30 s) less a margin for the writes.
const BUDGET_MS = 27_000;

/**
 * Translates the caller's analysis into the interface language, once: the page shows "Translating…"
 * and refreshes. Ownership first; the translation consumes no quota and is
 * rate-limited inside. Another tab asking for the same one waits for it instead of paying twice.
 */
export async function translateAnalysisAction(input: unknown): Promise<ActionResult<{ outcome: TranslationOutcome }>> {
  const deadline = Date.now() + BUDGET_MS;
  try {
    const userId = await requireUserId();
    const parsed = resumeIdInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid translation input");

    const locale = await getLocale();
    if (locale === "en") return { ok: true, data: { outcome: "unneeded" } };

    const analysis = await fetchResumeById(parsed.data.resumeId);
    if (!analysis?.feedback) throw new NotFoundError("No analysis to translate");
    const { id, companyName, jobTitle, feedback } = analysis;

    const outcome = await translateAnalysis(userId, { id, companyName, jobTitle, feedback }, locale, deadline);
    return { ok: true, data: { outcome } };
  } catch (error) {
    return toActionError(error, "Failed to translate an analysis");
  }
}
