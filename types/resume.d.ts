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
  userId: string;
  feedback: Feedback;
  createdAt: string;
};

export type Feedback = {
  overall: {
    globalScore: number;
    verdict: "Excellent" | "Good" | "Average" | "Poor";
    summaryText: string;
    prioritizedFixes: {
      title: string;
      impact: "High" | "Medium" | "Low";
      action: string;
    }[];
  };

  atsCompatibility: {
    score: number;
    description: string;
    problems: string[];
    fixes: string[];
    evidence: string[];
  };

  experienceAndImpact: {
    score: number;
    description: string;
    strengths: string[];
    weaknesses: string[];
    suggestedBullets: {
      role: string;
      examples: string[];
    }[];
  };

  skills: {
    score: number;
    description: string;
    matchedSkills: { name: string; evidence: string }[];
    missingSkills: string[];
    actionPlan: string[];
  };

  educationAndCertifications: {
    score: number;
    description: string;
    highlights: string[];
    improvements: string[];
    recommendedCerts: string[];
  };

  toneAndClarity: {
    score: number;
    description: string;
    readability: number;
    suggestions: string[];
  };

  jobFit: {
    score: number;
    description: string;
    matchedKeywords: string[];
    missingKeywords: string[];
    strategicRecommendations: string[];
  };
};

export type CreateResumeInput = {
  companyName: string;
  jobTitle: string;
  jobDescription: string;
  resume: File | null;
};
