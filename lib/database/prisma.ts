import { DBInterviewFeedback, DBResumeAnalysis } from "@prisma/client";
import type {
  ResumeAnalysisFeedback,
  ResumeAnalysis,
} from "../../types/resume";
import { InterviewFeedback } from "@/types/interview";

//Converts a Prisma `Resume` record (where JSON fields are `any`) to the strongly typed `ResumeAnalysis`.
export function mapDbResume(db: DBResumeAnalysis): ResumeAnalysis {
  return {
    id: db.id,
    companyName: db.companyName,
    jobTitle: db.jobTitle,
    jobDescription: db.jobDescription,
    resumeUrl: db.resumeUrl,
    userId: db.userId,
    feedback: db.feedback as ResumeAnalysisFeedback,
    createdAt: db.createdAt.toISOString(),
  };
}

// Converts a Prisma `InterviewFeedback` record to the strongly typed `InterviewFeedback`.
export function mapDbInterviewFeedback(
  db: DBInterviewFeedback
): InterviewFeedback {
  return {
    id: db.id,
    interviewId: db.interviewId,
    totalScore: db.totalScore,
    categoryScores: db.categoryScores,
    strengths: db.strengths,
    areasForImprovement: db.areasForImprovement,
    finalAssessment: db.finalAssessment,
  };
}
