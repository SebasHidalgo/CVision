import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { handleError } from "@/lib/error/handleError";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import type { ResumeAnalysis } from "@/types/resume";
import { mapDbResume, resumeInclude } from "./mappers";

export type CreateResumeData = {
  companyName: string;
  jobTitle: string;
  jobDescription: string;
  resumeUrl: string;
  feedback: ResumeAnalysisFeedback;
};

// Prisma types Json columns as a recursive union that a concrete object is not
// assignable to. One documented cast instead of one per field.
const toJson = (value: unknown) => value as Prisma.InputJsonValue;

export async function createResume(data: CreateResumeData): Promise<string> {
  try {
    const userId = await requireUserId();

    const created = await prisma.resumeAnalysis.create({
      data: {
        companyName: data.companyName,
        jobTitle: data.jobTitle,
        jobDescription: data.jobDescription,
        resumeUrl: data.resumeUrl,
        userId,
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
    });

    return created.id;
  } catch (error) {
    handleError(error, "Failed to create a resume analysis record");
  }
}


/** Analyses belonging to the current session user. */
export async function fetchAllResumes(): Promise<ResumeAnalysis[]> {
  try {
    const userId = await requireUserId();

    const dbResumes = await prisma.resumeAnalysis.findMany({
      where: { userId },
      include: resumeInclude,
      orderBy: { createdAt: "desc" },
    });

    return dbResumes.map(mapDbResume);
  } catch (error) {
    handleError(error, "Failed to retrieve all resume analysis records");
  }
}

/**
 * Ownership lives in the `where` clause, so it can't be skipped and there is no
 * gap between reading and checking. `null` covers both "missing" and "not
 * yours": telling them apart would leak the existence of other users' ids.
 */
export async function fetchResumeById(
  id: string
): Promise<ResumeAnalysis | null> {
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
