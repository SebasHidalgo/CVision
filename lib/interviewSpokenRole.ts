import "server-only";

import type { Prisma } from "@prisma/client";
import type { InterviewLanguage } from "@/lib/ai/postingLanguage";
import { spokenTitle } from "@/lib/ai/spokenTitle";
import { SPOKEN_TITLE_TIMEOUT_MS, spokenTitleHash, translateSpokenTitle } from "@/lib/ai/spokenRoleTitle";
import { claimTranslation, completeTranslation, failTranslation } from "@/lib/database/translation";

/**
 * The job title the interviewer says, when the interview's language is not the posting's: translated
 * once per analysis and language, stored beside the analysis' translations (locale "title-en" or
 * "title-es"), and reused by every later start. The page keeps the posting's title. Never throws:
 * anything that goes wrong leaves the title as the posting wrote it.
 */

/** The stored row's locale: a title, not the analysis' prose. */
export const spokenTitleLocale = (language: InterviewLanguage) => `title-${language}`;

const LOG = "[CVision][spoken-title]";

export async function spokenRoleTitle({
  userId,
  analysisId,
  title,
  company,
  from,
  to,
}: {
  userId: string;
  analysisId: string;
  title: string;
  company: string;
  /** The posting's language. */
  from: InterviewLanguage;
  /** The interview's. */
  to: InterviewLanguage;
}): Promise<string | null> {
  if (from === to) return null;
  // The posting's own spoken form first: seniority said in full, one gender form.
  const source = spokenTitle(title.replace(/\s+/g, " ").trim(), from);
  if (!source) return null;
  try {
    const claim = await claimTranslation(userId, { analysisId }, spokenTitleLocale(to), spokenTitleHash(source, from, to));
    if (claim.kind === "ready") return readText(claim.row.payload);
    if (claim.kind !== "claimed") return null;
    const { row } = claim;
    try {
      const result = await translateSpokenTitle({ title: source, company, from, to, deadline: Date.now() + SPOKEN_TITLE_TIMEOUT_MS + 2_000 });
      if (!result.text) {
        console.warn(`${LOG} analysis=${analysisId} to=${to} kept the posting's title: ${result.checks.join(",")} after ${result.attempts} attempt(s)`);
        await failTranslation(row.id, row.claimedAt);
        return null;
      }
      const stats: Prisma.InputJsonValue = { attempts: result.attempts, checks: result.checks };
      await completeTranslation(row.id, row.claimedAt, { payload: { text: result.text }, guardStats: stats, model: result.model, modelVersion: result.modelVersion });
      return result.text;
    } catch (error) {
      console.warn(`${LOG} analysis=${analysisId} to=${to} kept the posting's title: ${(error as { code?: string })?.code ?? "UNKNOWN"}`);
      await failTranslation(row.id, row.claimedAt).catch(() => undefined);
      return null;
    }
  } catch (error) {
    console.warn(`${LOG} analysis=${analysisId} to=${to} not read:`, (error as { code?: string })?.code ?? "UNKNOWN");
    return null;
  }
}

function readText(payload: unknown): string | null {
  const text = (payload as { text?: unknown } | null)?.text;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}
