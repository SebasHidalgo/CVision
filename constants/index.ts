export const AIResponseFormat = `
    {
        overall: {
            globalscore: number; //max 100
            verdict: "Excellent" | "Good" | "Average" | "Poor";
            summaryText: string;
            tips: {  //give 3-4 tips
                type: "Excellent" | "Good" | "Improve";
                description: string;
            }[];
        };
        atsCompatibility: {
            score: number; //rate based on ATS suitability
            description: string;
            highlights: string[]; // positive aspects
            tips: {  //give 3-4 tips
                type: "Excellent" | "Good" | "Improve";
                description: string;
            }[];
        };
        experience: {
            score: number; //max 100
            description: string;
            highlights: string[]; // positive aspects
            tips: {  //give 3-4 tips
                type: "Excellent" | "Good" | "Improve";
                description: string;
            }[];
        };
        education: {
            score: number; //max 100
            description: string;
            highlights: string[]; // positive aspects
            tips: {  //give 3-4 tips
                type: "Excellent" | "Good" | "Improve";
                description: string;
            }[];
        };
        skills: {
            score: number; //max 100
            description: string;
            highlights: string[]; // positive aspects
            tips: {  //give 3-4 tips
                type: "Excellent" | "Good" | "Improve";
                description: string;
            }[];
            missingSkills: string[];
            matchedSkills: string[];
        };
        toneAndLanguage: {
            score: number; //max 100
            description: string;
            highlights: string[]; // positive aspects
            tips: {  //give 3-4 tips
                type: "Excellent" | "Good" | "Improve";
                description: string;
            }[];
            tone: "Formal" | "Informal" | "Neutral";
            readabilityscore: number; //max 100
        };
        jobDescriptionAlignment: {
            score: number; //max 100
            description: string;
            highlights: string[]; // positive aspects
            tips: {  //give 3-4 tips
                type: "Excellent" | "Good" | "Improve";
                description: string;
            }[];
            matchedKeywords: string[]; 
            missingKeywords: string[];
        };
};`;

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
