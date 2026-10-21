import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { handleError } from "@/lib/error/handleError";
import type { GuardStats } from "@/lib/ai/schemas";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import type { ResumeAnalysis } from "@/types/resume";
import { recordGuardStatsDaily } from "./guardStats";
import { mapDbResume, resumeInclude } from "./mappers";
import { isVisible, visibleAnalysisIds } from "./visibility";

export type CreateResumeData = {
  /** Minted by the action before the usage unit is reserved, so the ledger can name the analysis. */
  id: string;
  companyName: string;
  jobTitle: string;
  jobDescription: string;
  /** The object's key in the private bucket, `cv/{userId}/{uuid}.pdf`. */
  resumeKey: string;
  feedback: ResumeAnalysisFeedback;
  /** What the guardrail did to the model's answer, for `npm run report:guards`. */
  guardStats: GuardStats;
};

// Prisma types Json columns as a recursive union that a concrete object is not
// assignable to. One documented cast instead of one per field.
const toJson = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Stores the analysis, its feedback and, in the same transaction, the day's
 * anonymous guardrail tallies, so the two cannot drift apart. Database
 * writes only inside the transaction: nothing external is awaited there.
 */
export async function createResume(data: CreateResumeData, now = new Date()): Promise<string> {
  try {
    const userId = await requireUserId();

    return await prisma.$transaction(async (tx) => {
      const created = await tx.resumeAnalysis.create({
        data: {
          id: data.id,
          companyName: data.companyName,
          jobTitle: data.jobTitle,
          jobDescription: data.jobDescription,
          resumeKey: data.resumeKey,
          userId,
          createdAt: now,
          guardStats: toJson(data.guardStats),
          feedback: {
            create: {
              overall: toJson(data.feedback.overall),
              atsCompatibility: toJson(data.feedback.atsCompatibility),
              experienceAndImpact: toJson(data.feedback.experienceAndImpact),
              educationAndCertifications: toJson(
                data.feedback.educationAndCertifications
              ),
              skills: toJson(data.feedback.skills),
              toneAndClarity: toJson(data.feedback.toneAndClarity),
              jobFit: toJson(data.feedback.jobFit),
            },
          },
        },
        select: { id: true },
      });
      await recordGuardStatsDaily(tx, "ANALYSIS", now, data.guardStats);
      return created.id;
    });
  } catch (error) {
    handleError(error, "Failed to create a resume analysis record");
  }
}


export type VisibleResumes = {
  /** The analyses the plan shows, newest first. */
  analyses: ResumeAnalysis[];
  /** Older ones the plan hides (Free's history rule); zero for Pro. */
  hidden: number;
};

/** The caller's analyses within the plan's history, and how many are hidden beyond it. */
export async function fetchVisibleResumes(): Promise<VisibleResumes> {
  try {
    const userId = await requireUserId();

    const [dbResumes, visible] = await Promise.all([
      prisma.resumeAnalysis.findMany({
        where: { userId },
        include: resumeInclude,
        orderBy: { createdAt: "desc" },
      }),
      visibleAnalysisIds(userId),
    ]);
    const shown = dbResumes.filter((row) => isVisible(visible, row.id));

    return { analyses: shown.map(mapDbResume), hidden: dbResumes.length - shown.length };
  } catch (error) {
    handleError(error, "Failed to retrieve the resume analysis records");
  }
}

/** The CV's storage key of one of the caller's analyses; `null` when missing or not theirs. */
export async function fetchResumeKey(id: string): Promise<string | null> {
  try {
    const userId = await requireUserId();

    const row = await prisma.resumeAnalysis.findFirst({
      where: { id, userId },
      select: { resumeKey: true },
    });

    return row?.resumeKey ?? null;
  } catch (error) {
    handleError(error, "Failed to retrieve resume key");
  }
}

export type ResumeAccess =
  /** Not there, or another user's: the two are not told apart. */
  | { kind: "missing" }
  /** The caller's, but beyond the plan's history: the page shows an upgrade notice. */
  | { kind: "hidden" }
  | { kind: "visible"; analysis: ResumeAnalysis };

/**
 * Ownership lives in the `where` clause, so it can't be skipped and there is no
 * gap between reading and checking. "missing" covers both "not there" and
 * "not yours": telling them apart would leak the existence of other users'
 * ids. "hidden" is the caller's own analysis beyond the plan's history.
 */
export async function fetchResumeAccess(id: string): Promise<ResumeAccess> {
  try {
    const userId = await requireUserId();

    const dbResume = await prisma.resumeAnalysis.findFirst({
      where: { id, userId },
      include: resumeInclude,
    });
    if (!dbResume) return { kind: "missing" };

    const visible = await visibleAnalysisIds(userId);
    if (!isVisible(visible, dbResume.id)) return { kind: "hidden" };

    return { kind: "visible", analysis: mapDbResume(dbResume) };
  } catch (error) {
    handleError(error, "Failed to retrieve resume analysis record");
  }
}

/** The analysis when the caller may see it; `null` when missing, another user's, or hidden by the plan. */
export async function fetchResumeById(id: string): Promise<ResumeAnalysis | null> {
  const access = await fetchResumeAccess(id);
  return access.kind === "visible" ? access.analysis : null;
}
