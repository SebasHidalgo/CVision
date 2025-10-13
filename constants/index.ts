export const AIResponseFormat = `
{
  overall: {
    globalScore: number; //max 100
    verdict: "Excellent" | "Good" | "Average" | "Poor";
    summaryText: string;
    tips: string[]; // always give 3-4 specific and actionable tips
  };
  atsCompatibility: {
    score: number; //rate based on ATS suitability
    description: string; // min 150 characters, include specific examples of what helps or hurts ATS parsing
    highlights: string[]; // always 3-4 specific strengths, not generic statements
    tips: string[]; // always 3-4 actionable and concrete improvements
  };
  experience: {
    score: number; //max 100
    description: string; // min 150 characters, mention how well the roles match the job title and how achievements are presented
    highlights: string[]; // always 3-4 specific strengths, not generic statements
    tips: string[]; // always give 3-4 specific and actionable tips
  };
  education: {
    score: number; //max 100
    description: string; // min 150 characters, describe how education relates to the target job and if degrees/certifications stand out
    highlights: string[]; // always 3-4 specific strengths, not generic statements
    tips: string[]; // always give 3-4 specific and actionable tips
  };
  skills: {
    score: number; //max 100
    description: string; // min 150 characters, reference specific skills mentioned or missing in the resume compared to the job description
    highlights: string[]; // always 3-4 specific strengths, not generic statements
    tips: string[]; // always give 3-4 specific and actionable tips
    missingSkills: string[];
    matchedSkills: string[];
  };
  toneAndLanguage: {
    score: number; //max 100
    description: string; // min 150 characters, describe tone and clarity using specific examples (e.g., overly casual phrases, strong verbs used)
    highlights: string[]; // always 3-4 specific strengths, not generic statements
    tips: string[]; // always give 3-4 specific and actionable tips
    tone: "Formal" | "Informal" | "Neutral";
    readabilityscore: number; //max 100
  };
  jobDescriptionAlignment: {
    score: number; //max 100
    description: string; // min 150 characters, mention how closely the resume aligns with the job description, citing examples of keyword overlap
    highlights: string[]; // always 3-4 specific strengths, not generic statements
    tips: string[]; // always give 3-4 specific and actionable tips
    matchedKeywords: string[];
    missingKeywords: string[];
  };
}`;

export const defaultPrompt = ({
  jobTitle,
  jobDescription,
  resumeText,
}: {
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
}) =>
  `You are an expert in ATS (Applicant Tracking System) and resume analysis.
      Please analyze and rate this resume and suggest how to improve it.
      The rating can be low if the resume is bad.
      Be thorough and detailed. Don't be afraid to point out any mistakes or areas for improvement.
      If there is a lot to improve, don't hesitate to give low scores. This is to help the user to improve their resume.
      If available, use the job description for the job user is applying to to give more detailed feedback.
      If provided, take the job description into consideration.
      The job title is: ${jobTitle}
      The job description is: ${jobDescription}
      The resume text is: ${resumeText}
      Provide the feedback using the following format: Please make sure to follow the format exactly as specified here
      ${AIResponseFormat}
      Return the analysis as an JSON object, without any other text and without the backticks. Please ensure the JSON is properly formatted and can be parsed by a JSON parser.
      Do not include any other text or comments.`;
