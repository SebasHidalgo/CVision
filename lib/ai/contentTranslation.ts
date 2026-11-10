import "server-only";

import type { TargetLocale } from "@/lib/ai/prompts/translation.prompt";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import { withProse, type ProseMap } from "@/lib/ai/translatableProse";
import {
  analysisTranslationInput,
  feedbackTranslationInput,
  TRANSLATION_TIMEOUT_MS,
  translateProse,
  translationSourceHash,
  type AnalysisForTranslation,
  type FeedbackForTranslation,
} from "@/lib/ai/translation";
import { assertRateLimit } from "@/lib/database/rateLimit";
import {
  claimTranslation,
  completeTranslation,
  failTranslation,
  readOwnTranslation,
  readTranslation,
  TRANSLATION_RETRY_AFTER_MS,
  type TranslationParent,
  type TranslationRow,
} from "@/lib/database/translation";
import { AppError } from "@/lib/error/errors";
import { renderAnalysis } from "@/lib/i18n/analysisView";
import type { Locale } from "@/lib/i18n/config";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

export { analysisTranslationInput, feedbackTranslationInput, type AnalysisForTranslation, type FeedbackForTranslation };

/**
 * Model prose translated once per item and language, stored, and served on every later view.
 * Nothing here can change a result: only prose is sent, and the page's verdict, statuses and
 * quotes come from the canonical English row. Translations never consume a quota; they are
 * rate-limited per user (lib/plans.ts, `translation`).
 */

/** What a page shows: the translation, part of it (some strings kept English), or why not. */
export type TranslationState = "none" | "ready" | "partial" | "pending" | "unavailable";

export type TranslationOutcome = "ready" | "failed" | "unneeded" | "missing";

const WAIT_STEP_MS = 1_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Claims, translates and stores; or waits for the request that holds the claim. Never throws. */
async function ensureTranslation({
  userId,
  parent,
  locale,
  sources,
  protectedTerms,
  deadline,
  logId,
}: {
  userId: string;
  parent: TranslationParent;
  locale: TargetLocale;
  sources: ProseMap;
  protectedTerms: string[];
  /** Epoch ms by which the call must have returned: the route's maxDuration, less a margin. */
  deadline: number;
  logId: string;
}): Promise<TranslationOutcome> {
  if (Object.keys(sources).length === 0) return "unneeded";
  const sourceHash = translationSourceHash(sources, locale);
  try {
    while (Date.now() < deadline) {
      const claim = await claimTranslation(userId, parent, locale, sourceHash);
      if (claim.kind === "missing") return "missing";
      if (claim.kind === "ready") return "ready";
      if (claim.kind === "failed") return "failed";
      if (claim.kind === "busy") {
        // Another tab is translating it: wait for its row instead of paying twice.
        await sleep(WAIT_STEP_MS);
        const row = await readTranslation(userId, parent, locale);
        if (row?.status === "READY" && row.sourceHash === sourceHash) return "ready";
        if (row?.status === "FAILED" && row.sourceHash === sourceHash) return "failed";
        continue;
      }
      const { row } = claim;
      const startedAt = Date.now();
      try {
        await assertRateLimit(userId, "translation");
        const timeoutMs = Math.min(TRANSLATION_TIMEOUT_MS, deadline - Date.now());
        if (timeoutMs < 3_000) throw new Error("no time left for the translation");
        const result = await translateProse({ sources, locale, protectedTerms, timeoutMs });
        const guardStats = { ...result.stats, ms: Date.now() - startedAt, input: result.input, output: result.output };
        await completeTranslation(row.id, row.claimedAt, { payload: result.kept, guardStats, model: result.model, modelVersion: result.modelVersion });
        const failures = Object.entries(result.stats.counts).map(([check, count]) => `${check}=${count}`).join(" ");
        // Counts and ids only: the strings are the user's analysis.
        console.info(`[CVision][i18n] translated ${logId} ${locale}: ${result.stats.kept}/${result.stats.strings} kept${failures ? `, ${failures}` : ""}, ${Date.now() - startedAt} ms`);
        return "ready";
      } catch (error) {
        await failTranslation(row.id, row.claimedAt);
        console.warn(`[CVision][i18n] translation failed ${logId} ${locale}: ${error instanceof AppError ? error.code : error instanceof Error ? error.message : "unknown"}`);
        return "failed";
      }
    }
    return "failed";
  } catch (error) {
    console.error(`[CVision][i18n] translation error ${logId}: ${error instanceof Error ? error.name : "unknown"}`);
    return "failed";
  }
}


/** Translates an analysis' prose into the locale, once. `deadline` bounds the whole call. */
export async function translateAnalysis(userId: string, analysis: AnalysisForTranslation, locale: Locale, deadline: number): Promise<TranslationOutcome> {
  if (locale === "en") return "unneeded";
  return ensureTranslation({ userId, parent: { analysisId: analysis.id }, locale, ...analysisTranslationInput(analysis), deadline, logId: analysis.id });
}


export async function translateFeedback(userId: string, feedback: FeedbackForTranslation, locale: Locale, deadline: number): Promise<TranslationOutcome> {
  if (locale === "en") return "unneeded";
  return ensureTranslation({ userId, parent: { interviewFeedbackId: feedback.id }, locale, ...feedbackTranslationInput(feedback), deadline, logId: feedback.id });
}

/** The page's state for a stored translation row. */
function stateOf(row: TranslationRow | null, sourceHash: string, now: number): { state: TranslationState; payload: ProseMap | null } {
  if (row && row.sourceHash === sourceHash && row.status === "READY") {
    const payload = (row.payload ?? {}) as ProseMap;
    const stats = row.guardStats as { strings?: number; kept?: number } | null;
    const partial = stats?.strings !== undefined && stats.kept !== undefined && stats.kept < stats.strings;
    return { state: partial ? "partial" : "ready", payload };
  }
  if (row && row.sourceHash === sourceHash && row.status === "FAILED" && row.failedAt && now - row.failedAt.getTime() < TRANSLATION_RETRY_AFTER_MS) {
    return { state: "unavailable", payload: null };
  }
  return { state: "pending", payload: null };
}

/**
 * An analysis as the page shows it in a language: code-made sentences rendered there, model prose
 * from the stored translation when there is one for exactly this content, English otherwise. The
 * state says which, so a page that mixes languages always says so.
 */
export async function localizedAnalysis(
  analysis: AnalysisForTranslation,
  locale: Locale,
  options: { original?: boolean } = {},
): Promise<{ feedback: ResumeAnalysisFeedback; state: TranslationState }> {
  if (locale === "en") return { feedback: renderAnalysis(analysis.feedback, "en"), state: "none" };
  const { sources } = analysisTranslationInput(analysis);
  if (Object.keys(sources).length === 0) return { feedback: renderAnalysis(analysis.feedback, locale), state: "none" };
  if (options.original) return { feedback: renderAnalysis(analysis.feedback, locale), state: "unavailable" };
  const row = await readOwnTranslation({ analysisId: analysis.id }, locale);
  const { state, payload } = stateOf(row, translationSourceHash(sources, locale), Date.now());
  const translated = payload ? withProse(analysis.feedback, payload) : analysis.feedback;
  return { feedback: renderAnalysis(translated, locale), state };
}

/** An interview feedback's report as the page shows it in a language; same contract as localizedAnalysis. */
export async function localizedFeedback(
  feedback: FeedbackForTranslation,
  locale: Locale,
  options: { original?: boolean } = {},
): Promise<{ report: InterviewFeedbackReport; state: TranslationState }> {
  if (locale === "en") return { report: feedback.report, state: "none" };
  const { sources } = feedbackTranslationInput(feedback);
  if (Object.keys(sources).length === 0) return { report: feedback.report, state: "none" };
  if (options.original) return { report: feedback.report, state: "unavailable" };
  const row = await readOwnTranslation({ interviewFeedbackId: feedback.id }, locale);
  const { state, payload } = stateOf(row, translationSourceHash(sources, locale), Date.now());
  return { report: payload ? withProse(feedback.report, payload) : feedback.report, state };
}
