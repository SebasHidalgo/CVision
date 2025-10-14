import type { ResumeAnalysis, Feedback } from "./resume";

declare module "@prisma/client" {
  export type DBResumeAnalysis = {
    id: string;
    companyName: string;
    jobTitle: string;
    resumeUrl: string;
    feedback: Feedback;
    createdAt: Date;
  };
}

export {};
