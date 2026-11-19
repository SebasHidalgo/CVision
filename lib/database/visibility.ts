import "server-only";

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { handleError } from "@/lib/error/handleError";
import { PLANS } from "@/lib/plans";
import { resolvePlanStanding } from "./billing";

/**
 * The Free history rule: a Free account sees its most recent analyses
 * (`PLANS.FREE.historyLimit`), the rest are hidden, never deleted. Hidden
 * means left out of the lists, an upgrade notice instead of the page, and
 * the same for the interviews that hang from them. Pro has no limit, so
 * upgrading reveals everything. No session: the callers pass the id they
 * resolved; the reads that apply this live in resume.ts and interview.ts.
 */

/** The one order of a user's analyses, in the lists and in the history rule: newest first, the id breaking ties. */
export const NEWEST_FIRST: Prisma.ResumeAnalysisOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

/** What the list shows of an analysis beyond the history: no content. */
const SUMMARY = { id: true, jobTitle: true, companyName: true, createdAt: true } as const;

export type AnalysisSummary = Prisma.ResumeAnalysisGetPayload<{ select: typeof SUMMARY }>;

/** The ids the user may see, or null when every analysis is visible. */
export async function visibleAnalysisIds(userId: string, now = new Date()): Promise<Set<string> | null> {
  try {
    const { plan } = await resolvePlanStanding(userId, now);
    const limit = PLANS[plan].historyLimit;
    if (limit === null) return null;

    const rows = await prisma.resumeAnalysis.findMany({
      where: { userId },
      orderBy: NEWEST_FIRST,
      take: limit,
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  } catch (error) {
    handleError(error, `Failed to resolve the visible analyses (user=${userId})`);
  }
}

export type AnalysisHistory = {
  /** The analyses the list shows in full, newest first; null when the plan shows every one. */
  visibleIds: string[] | null;
  /** The ones beyond the history, newest first, without content; empty when the plan shows every one. */
  hidden: AnalysisSummary[];
};

/**
 * The user's analyses split by the plan's history, from one read of their
 * summaries (never their content): the split cannot disagree with itself,
 * and a Free account with a long history costs a few small columns per
 * row, not every analysis's JSON. The plan and the read run together.
 */
export async function analysisHistory(userId: string, now = new Date()): Promise<AnalysisHistory> {
  try {
    const [{ plan }, rows] = await Promise.all([
      resolvePlanStanding(userId, now),
      prisma.resumeAnalysis.findMany({ where: { userId }, orderBy: NEWEST_FIRST, select: SUMMARY }),
    ]);
    const limit = PLANS[plan].historyLimit;
    if (limit === null) return { visibleIds: null, hidden: [] };
    return { visibleIds: rows.slice(0, limit).map((row) => row.id), hidden: rows.slice(limit) };
  } catch (error) {
    handleError(error, `Failed to read the analysis history (user=${userId})`);
  }
}

/**
 * The analyses beyond the plan's history, newest first; none when every
 * analysis is visible. One read that skips past the visible ones, never a
 * second read against `visibleAnalysisIds`: an analysis created between the
 * two would read as hidden, and a delete of "the hidden ones" would take it.
 */
export async function hiddenAnalysisRows(userId: string, now = new Date()) {
  try {
    const { plan } = await resolvePlanStanding(userId, now);
    const limit = PLANS[plan].historyLimit;
    if (limit === null) return [];

    return await prisma.resumeAnalysis.findMany({
      where: { userId },
      orderBy: NEWEST_FIRST,
      skip: limit,
      select: SUMMARY,
    });
  } catch (error) {
    handleError(error, `Failed to read the hidden analyses (user=${userId})`);
  }
}

/** Whether one analysis (already known to be the user's) is within the plan's history. */
export function isVisible(visible: Set<string> | null, analysisId: string | null): boolean {
  if (visible === null || analysisId === null) return true;
  return visible.has(analysisId);
}
