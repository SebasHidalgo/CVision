import type { ResumeAnalysis, Feedback } from "./resume";

declare module "@prisma/client" {
  export type DBResumeAnalysis = {
    id: string;
    companyName: string;
    jobTitle: string;
    resumeUrl: string;
    userId: string;
    feedback: Feedback;
    createdAt: Date;
  };
}

export {};
