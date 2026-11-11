"use server";

import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { translateFeedback, type TranslationOutcome } from "@/lib/ai/contentTranslation";
import { fetchFeedbackByInterviewId } from "@/lib/database/interview";
import { fetchResumeById } from "@/lib/database/resume";
import { fetchInterviewById } from "@/lib/database/interview";
import { NotFoundError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { getLocale } from "@/lib/i18n/server";
import type { ActionResult } from "@/types/action";

const inputSchema = z.object({ interviewId: z.uuid() });

// Well inside the feedback page's maxDuration; the translation's own timeout is 25 s.
const BUDGET_MS = 30_000;

/** Translates the caller's interview feedback into the interface language, once. Same contract as translateAnalysisAction. */
export async function translateFeedbackAction(input: unknown): Promise<ActionResult<{ outcome: TranslationOutcome }>> {
  const deadline = Date.now() + BUDGET_MS;
  try {
    const userId = await requireUserId();
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid translation input");

    const locale = await getLocale();
    if (locale === "en") return { ok: true, data: { outcome: "unneeded" } };

    const interview = await fetchInterviewById(parsed.data.interviewId);
    const feedback = interview ? await fetchFeedbackByInterviewId(interview.id) : null;
    if (!interview || !feedback) throw new NotFoundError("No feedback to translate");
    // The analysis supplies the protected terms; a hidden or deleted one leaves the role only.
    const analysis = interview.resumeAnalysisId ? await fetchResumeById(interview.resumeAnalysisId) : null;

    const outcome = await translateFeedback(
      userId,
      {
        id: feedback.id,
        report: feedback.report,
        role: feedback.role,
        analysis: analysis?.feedback ? { id: analysis.id, companyName: analysis.companyName, jobTitle: analysis.jobTitle, feedback: analysis.feedback } : null,
      },
      locale,
      deadline,
    );
    return { ok: true, data: { outcome } };
  } catch (error) {
    return toActionError(error, "Failed to translate an interview feedback");
  }
}
