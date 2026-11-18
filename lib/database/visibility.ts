import "server-only";

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

/** The ids the user may see, or null when every analysis is visible. */
export async function visibleAnalysisIds(userId: string, now = new Date()): Promise<Set<string> | null> {
  try {
    const { plan } = await resolvePlanStanding(userId, now);
    const limit = PLANS[plan].historyLimit;
    if (limit === null) return null;

    const rows = await prisma.resumeAnalysis.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  } catch (error) {
    handleError(error, `Failed to resolve the visible analyses (user=${userId})`);
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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: limit,
      select: { id: true, jobTitle: true, companyName: true, createdAt: true },
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
