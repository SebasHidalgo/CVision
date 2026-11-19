import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { handleError } from "@/lib/error/handleError";
import type { GuardStats } from "@/lib/ai/schemas";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import type { ResumeAnalysis } from "@/types/resume";
import { recordGuardStatsDaily } from "./guardStats";
import { settleAnalysisUnitIn } from "./usage";
import { mapDbResume, resumeInclude } from "./mappers";

/** The one order of a user's analyses in the list: newest first, the id breaking ties. */
const NEWEST_FIRST: Prisma.ResumeAnalysisOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

export type CreateResumeData = {
  /** Derived by the action from the submission before the unit is reserved, so the ledger can name the analysis. */
  id: string;
  companyName: string;
  jobTitle: string;
  jobDescription: string;
  /** The object's key in the private bucket, `cv/{userId}/{uuid}.pdf`. */
  resumeKey: string;
  feedback: ResumeAnalysisFeedback;
  /** What the guardrail did to the model's answer, for `npm run report:guards`. */
  guardStats: GuardStats;
  /** The analysis unit reserved for it: spent in the insert's transaction. */
  usageEventId: string;
};

export type CreatedResume =
  | { kind: "saved"; id: string }
  /** The unit was given back before the insert (a retry of the submission took it as dead, or the sweep): nothing saved. */
  | { kind: "unit-released" };

// Prisma types Json columns as a recursive union that a concrete object is not
// assignable to. One documented cast instead of one per field.
const toJson = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Spends the analysis unit and stores the analysis, its feedback and the
 * day's anonymous guardrail tallies, in one transaction: no request can die
 * between the charge and the row, and a unit given back meanwhile saves
 * nothing (`unit-released`). Database writes only inside the transaction:
 * nothing external is awaited there.
 */
export async function createResume(data: CreateResumeData, now = new Date()): Promise<CreatedResume> {
  try {
    const userId = await requireUserId();

    return await prisma.$transaction(async (tx) => {
      // The settle first: an insert that fails rolls it back, so the unit stays held for the caller's refund.
      if (!(await settleAnalysisUnitIn(tx, { eventId: data.usageEventId, userId }, now))) return { kind: "unit-released" as const };

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
      return { kind: "saved" as const, id: created.id };
    });
  } catch (error) {
    handleError(error, "Failed to create a resume analysis record");
  }
}


/** The caller's analyses, newest first, each with its interviews. Every one, on every plan. */
export async function fetchResumes(): Promise<ResumeAnalysis[]> {
  try {
    const userId = await requireUserId();

    const rows = await prisma.resumeAnalysis.findMany({
      where: { userId },
      include: resumeInclude,
      orderBy: NEWEST_FIRST,
    });

    return rows.map(mapDbResume);
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

/**
 * One of the caller's analyses; `null` when it doesn't exist or belongs to another user. Ownership lives in the
 * `where` clause, so it can't be skipped and there is no gap between reading and checking; the two nulls are not told
 * apart, which would leak the existence of other users' ids.
 */
export async function fetchResumeById(id: string): Promise<ResumeAnalysis | null> {
  try {
    const userId = await requireUserId();

    const dbResume = await prisma.resumeAnalysis.findFirst({
      where: { id, userId },
      include: resumeInclude,
    });

    return dbResume ? mapDbResume(dbResume) : null;
  } catch (error) {
    handleError(error, "Failed to retrieve resume analysis record");
  }
}
