import { DBResume } from "@prisma/client";
import type { ResumeAnalysis } from "../types/resume";

//Converts a Prisma `Resume` record (where JSON fields are `any`) to the strongly typed `ResumeAnalysis`.
export function mapDbResume(db: DBResume): ResumeAnalysis {
  return {
    id: db.id,
    companyName: db.companyName,
    jobTitle: db.jobTitle,
    resumeUrl: db.resumeUrl,
    resumeImageUrl: db.resumeImageUrl,
    feedback: db.feedback as ResumeAnalysis["feedback"],
    createdAt: db.createdAt.toISOString(),
  };
}


