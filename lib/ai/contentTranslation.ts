import "server-only";

import type { GuardKind } from "@prisma/client";
import type { TargetLocale } from "@/lib/ai/prompts/translation.prompt";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import { withProse } from "@/lib/ai/translatableProse";
import type { TranslationGuardStats } from "@/lib/ai/translationGuards";
import {
  analysisTranslationInput,
  feedbackTranslationInput,
  nothingToTranslate,
  readPayload,
  translateContent,
  translationSourceHash,
  type AnalysisForTranslation,
  type FeedbackForTranslation,
  type TranslationJob,
  type TranslationPayload,
} from "@/lib/ai/translation";
import type { GuardStatIncrement } from "@/lib/database/guardStats";
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
import { pendingProse, renderAnalysis } from "@/lib/i18n/analysisView";
import type { Locale } from "@/lib/i18n/config";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

export { analysisTranslationInput, feedbackTranslationInput, type AnalysisForTranslation, type FeedbackForTranslation };

/**
 * Model prose (and the posting's terms the code-made sentences name) translated once per item and
 * language, stored, and served on every later view. Nothing here can change a result: the page's
 * verdict, statuses and quotes come from the canonical English row. Translations never consume a
 * quota; they are rate-limited per user (lib/plans.ts, `translation`).
 */

/** What a page shows: the translation, part of it (some strings kept English), or why not. */
export type TranslationState = "none" | "ready" | "partial" | "pending" | "unavailable";

export type TranslationOutcome = "ready" | "failed" | "unneeded" | "missing";

const WAIT_STEP_MS = 1_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const jobHash = (job: TranslationJob, locale: TargetLocale) => translationSourceHash(job.sources, locale, job.terms, job.names);

/** The day's anonymous tallies: one recorded, first-answer failures by check, and what each left behind. */
export function translationIncrements(stats: TranslationGuardStats): GuardStatIncrement[] {
  const increments: GuardStatIncrement[] = [{ check: "translation", action: "recorded", count: 1 }];
  for (const [check, count] of Object.entries(stats.counts)) if (count) increments.push({ check: `translation:${check}`, action: "failed-first", count });
  for (const [check, count] of Object.entries(stats.remaining)) if (count) increments.push({ check: `translation:${check}`, action: "after-retries", count });
  if (stats.fallbacks) increments.push({ check: "translation", action: "fallback", count: stats.fallbacks });
  return increments;
}

/** Claims, translates and stores; or waits for the request that holds the claim. Never throws. */
async function ensureTranslation({
  userId,
  parent,
  kind,
  locale,
  job,
  deadline,
  logId,
}: {
  userId: string;
  parent: TranslationParent;
  kind: GuardKind;
  locale: TargetLocale;
  job: TranslationJob;
  /** Epoch ms by which every call must have returned: the route's maxDuration, less a margin. */
  deadline: number;
  logId: string;
}): Promise<TranslationOutcome> {
  if (nothingToTranslate(job)) return "unneeded";
  const sourceHash = jobHash(job, locale);
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
        if (deadline - Date.now() < 3_000) throw new Error("no time left for the translation");
        const result = await translateContent({ ...job, locale, deadline });
        const guardStats = { ...result.stats, ms: Date.now() - startedAt, input: result.input, output: result.output };
        await completeTranslation(
          row.id,
          row.claimedAt,
          { payload: result.payload, guardStats, model: result.model, modelVersion: result.modelVersion },
          { kind, increments: translationIncrements(result.stats) },
        );
        const { stats } = result;
        // Counts, ids and paths only: the strings are the user's analysis.
        console.info(
          `[CVision][i18n] translated ${logId} ${locale}: ${stats.kept}/${stats.strings} kept, ${stats.calls} call(s), ${stats.retried} retried, terms ${stats.terms.names} names/${stats.terms.concepts} concepts, ${Date.now() - startedAt} ms`,
        );
        if (result.fallbacks.length) {
          console.error(
            `[CVision][i18n] translation fell back to English ${logId} ${locale}: ${result.fallbacks.map((one) => `${one.path} (${one.checks.join("+")})`).join(", ")}`,
          );
        }
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

/** Translates an analysis' prose and sentence terms into the locale, once. `deadline` bounds the whole call. */
export async function translateAnalysis(userId: string, analysis: AnalysisForTranslation, locale: Locale, deadline: number): Promise<TranslationOutcome> {
  if (locale === "en") return "unneeded";
  return ensureTranslation({ userId, parent: { analysisId: analysis.id }, kind: "ANALYSIS", locale, job: analysisTranslationInput(analysis), deadline, logId: analysis.id });
}

export async function translateFeedback(userId: string, feedback: FeedbackForTranslation, locale: Locale, deadline: number): Promise<TranslationOutcome> {
  if (locale === "en") return "unneeded";
  return ensureTranslation({
    userId,
    parent: { interviewFeedbackId: feedback.id },
    kind: "INTERVIEW",
    locale,
    job: feedbackTranslationInput(feedback),
    deadline,
    logId: feedback.id,
  });
}

/** The page's state for a stored translation row. */
function stateOf(row: TranslationRow | null, sourceHash: string, now: number): { state: TranslationState; payload: TranslationPayload | null } {
  if (row && row.sourceHash === sourceHash && row.status === "READY") {
    const payload = readPayload(row.payload);
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
 * An analysis as the page shows it in a language: code-made sentences rendered there with the stored
 * terms, model prose from the stored translation when there is one for exactly this content. Pending,
 * the prose (and the sentences that name terms) render as PENDING_PROSE for the page's skeletons.
 */
export async function localizedAnalysis(
  analysis: AnalysisForTranslation,
  locale: Locale,
  options: { original?: boolean } = {},
): Promise<{ feedback: ResumeAnalysisFeedback; state: TranslationState }> {
  if (locale === "en") return { feedback: renderAnalysis(analysis.feedback, "en"), state: "none" };
  const job = analysisTranslationInput(analysis);
  if (nothingToTranslate(job)) return { feedback: renderAnalysis(analysis.feedback, locale), state: "none" };
  if (options.original) return { feedback: renderAnalysis(analysis.feedback, locale), state: "unavailable" };
  const row = await readOwnTranslation({ analysisId: analysis.id }, locale);
  const { state, payload } = stateOf(row, jobHash(job, locale), Date.now());
  if (state === "pending") return { feedback: renderAnalysis(analysis.feedback, locale, { pending: true }), state };
  const translated = payload ? withProse(analysis.feedback, payload.strings) : analysis.feedback;
  return { feedback: renderAnalysis(translated, locale, { terms: payload?.terms }), state };
}

/** An interview feedback's report as the page shows it in a language; same contract as localizedAnalysis. */
export async function localizedFeedback(
  feedback: FeedbackForTranslation,
  locale: Locale,
  options: { original?: boolean } = {},
): Promise<{ report: InterviewFeedbackReport; state: TranslationState }> {
  if (locale === "en") return { report: feedback.report, state: "none" };
  const job = feedbackTranslationInput(feedback);
  if (nothingToTranslate(job)) return { report: feedback.report, state: "none" };
  if (options.original) return { report: feedback.report, state: "unavailable" };
  const row = await readOwnTranslation({ interviewFeedbackId: feedback.id }, locale);
  const { state, payload } = stateOf(row, jobHash(job, locale), Date.now());
  if (state === "pending") return { report: withProse(feedback.report, pendingProse(job.sources)), state };
  return { report: payload ? withProse(feedback.report, payload.strings) : feedback.report, state };
}
