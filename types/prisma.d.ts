import type { ResumeAnalysis, Feedback } from "./resume";

declare module "@prisma/client" {
  export type DBResumeAnalysis = {
    id: string;
    companyName: string;
    jobTitle: string;
    jobDescription: string;
    resumeUrl: string;
    userId: string;
    feedback: Feedback;
    createdAt: Date;
  };

  export type DBInterviewFeedback = {
    id: string;
    interviewId: string;
    totalScore: number;
    categoryScores: Array<{
      name: string;
      score: number;
      comment: string;
    }>;
    strengths: string[];
    areasForImprovement: string[];
    finalAssessment: string;
  };
}

export {};
