import type { Feedback, ResumeAnalysis } from "./resume";

declare module "@prisma/client" {
  export type DBResume = {
    id: string;
    companyName: string;
    jobTitle: string;
    resumeUrl: string;
    resumeImageUrl: string;
    feedback: Feedback;
    createdAt: Date;
  };
}

export {};
