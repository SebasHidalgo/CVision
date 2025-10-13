export type SectionFeedback = {
  score: number;
  description: string;
  highlights: string[];
  tips: string[];
};

export type ResumeAnalysis = {
  id: string;
  companyName: string;
  jobTitle: string;
  resumeUrl: string;
  feedback: Feedback;
  createdAt: string;
};

export type Feedback = {
  overall: {
    globalScore: number;
    verdict: "Excellent" | "Good" | "Average" | "Poor";
    summaryText: string;
    tips: Tip[];
  };
  atsCompatibility: SectionFeedback;
  experience: SectionFeedback;
  education: SectionFeedback;
  skills: SectionFeedback & {
    missingSkills: string[];
    matchedSkills: string[];
  };
  toneAndLanguage: SectionFeedback & {
    tone: "Formal" | "Informal" | "Neutral";
    readabilityScore: number;
  };
  jobDescriptionAlignment: SectionFeedback & {
    matchedKeywords: string[];
    missingKeywords: string[];
  };
};

export type ResumeAnalysisInput = Omit<ResumeAnalysis, "id" | "createdAt">;
