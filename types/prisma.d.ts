import type { Feedback, ResumeAnalysis } from "./resume";

declare module "@prisma/client" {
  export type DBResume = {
    id: string;
    companyName: string;
    jobTitle: string;
    resumeUrl: string;
    feedback: Feedback;
    createdAt: Date;
  };
}

export {};
