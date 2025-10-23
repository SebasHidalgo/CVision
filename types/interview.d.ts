import { z } from "zod";

export type Interview = {
  id: string;
  role: string;
  techstack: string[];
  userId: string;
  finalized: boolean;
  createdAt: Date;
};

export type CreateFeedbackParams = {
  interviewId: string;
  userId: string;
  transcript: { role: string; content: string }[];
  feedbackId?: string;
};

export type InterviewFeedback = {
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

export type InterviewDetails = {
  jobRole: string;
  jobDescription: string;
  resumeId: string;
};
