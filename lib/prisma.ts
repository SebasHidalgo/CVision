import { DBResumeAnalysis } from "@prisma/client";
import type { Feedback, ResumeAnalysis } from "../types/resume";

//Converts a Prisma `Resume` record (where JSON fields are `any`) to the strongly typed `ResumeAnalysis`.
export function mapDbResume(db: DBResumeAnalysis): ResumeAnalysis {
  return {
    id: db.id,
    companyName: db.companyName,
    jobTitle: db.jobTitle,
    resumeUrl: db.resumeUrl,
    userId: db.userId,
    feedback: db.feedback as Feedback,
    createdAt: db.createdAt.toISOString(),
  };
}
