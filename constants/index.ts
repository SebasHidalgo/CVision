import { z } from "zod";
import { CreateAssistantDTO } from "@vapi-ai/web/dist/api";

export const AIResponseFormat = `
{
  overall: {
    // Final global score (0-100) reflecting the overall quality and alignment
    // between the resume and the job description.
    globalScore: number;

    // One-word summary of the resume’s overall quality and readiness.
    // Options: "Excellent", "Good", "Average", or "Poor".
    verdict: "Excellent" | "Good" | "Average" | "Poor";

    // 2-4 sentences summarizing the resume’s key strengths and weaknesses,
    // ending with the top 3 priorities for improvement.
    summaryText: string;

    // A short, prioritized roadmap of the main fixes to make.
    // Each item should describe one concrete action and its expected impact.
    prioritizedFixes: {
      // Short title describing what to improve (e.g., “Add measurable results”)
      title: string;

      // Level of impact this change would have on overall resume quality.
      impact: "High" | "Medium" | "Low";

      // A clear, actionable step explaining how to fix it.
      action: string;
    }[];
  };

  atsCompatibility: {
    // 0-100 score evaluating how well the resume can be parsed by ATS systems.
    // Should consider formatting, keyword structure, and section labeling.
    score: number;

    // At least 150 characters explaining how formatting, sections, or keyword usage
    // help or hurt ATS readability. Include specific examples when possible.
    description: string;

    // 2-4 concrete, specific problems that affect ATS parsing.
    // Example: “Dates formatted inconsistently”, “Section headers not standard”.
    problems: string[];

    // 2-4 actionable fixes to improve ATS performance.
    // Must not repeat recommendations from other sections.
    fixes: string[];

    // 1-3 short text snippets or phrases from the resume
    // that serve as evidence of the analysis above.
    evidence: string[];
  };

  experienceAndImpact: {
    // 0-100 score evaluating experience quality, job relevance,
    // and use of measurable achievements.
    score: number;

    // At least 150 characters analyzing how experience is presented.
    // Mention clarity, structure, and whether achievements are quantified.
    description: string;

    // 2-4 concrete strengths, focusing on writing style, metrics, or clarity.
    // Example: “Uses strong action verbs”, “Achievements are measurable”.
    strengths: string[];

    // 2-4 specific weaknesses that limit impact.
    // Example: “No metrics provided”, “Bullets too long”, “Generic descriptions”.
    weaknesses: string[];

    // Suggest 1-3 example bullet points rewritten for the most relevant role(s),
    // showing improved phrasing and quantifiable results.
    suggestedBullets: {
      // Job role name (e.g., “Marketing Manager”)
      role: string;

      // 1-3 rewritten bullet examples demonstrating better phrasing.
      examples: string[];
    }[];
  };

  skills: {
    // 0-100 score evaluating the relevance, completeness, and clarity
    // of the skills section compared to the job description.
    score: number;

    // At least 150 characters explaining how the skills align or fail
    // to align with the job requirements. Reference specific examples.
    description: string;

    // List of skills that match the job description, with a short piece of
    // evidence showing where or how they appear in the resume.
    matchedSkills: { name: string; evidence: string }[];

    // List of missing or weakly represented skills from the job description.
    missingSkills: string[];

    // 2-4 clear and actionable steps explaining how to improve the skills section.
    // Example: “Group technical skills by category”, “Add proficiency levels”.
    actionPlan: string[];
  };

  educationAndCertifications: {
    // 0-100 score reflecting how strong and relevant the education
    // and certifications are for the job.
    score: number;

    // At least 120 characters describing degree relevance, visibility, and order.
    description: string;

    // 1-3 positive highlights (e.g., “Strong relevant degree”, “Certifications add credibility”).
    highlights: string[];

    // 1-3 specific, practical improvements (e.g., “Add graduation year”, “Reorder education before skills”).
    improvements: string[];

    // Optional: list of certifications that could strengthen the resume
    // (e.g., “AWS Certified Developer”, “Google Analytics Certification”).
    recommendedCerts: string[];
  };

  toneAndClarity: {
    // 0-100 score assessing tone, grammar, and overall readability.
    score: number;

    // At least 120 characters analyzing writing clarity and tone.
    // Include good and bad examples from the resume.
    description: string;

    // Readability index from 0-100 (higher = easier to read).
    // Based on Flesch or a similar readability metric.
    readability: number;

    // 2-4 suggestions for tone and language improvements.
    // Example: “Avoid jargon”, “Use shorter sentences”, “Replace passive verbs”.
    suggestions: string[];
  };

  jobFit: {
    // 0-100 score measuring alignment with the provided job description.
    score: number;

    // At least 150 characters explaining how closely the resume content
    // matches job requirements, keywords, and role expectations.
    description: string;

    // List of keywords that appear in both the job description and resume.
    matchedKeywords: string[];

    // Important keywords missing from the resume.
    missingKeywords: string[];

    // 3 specific strategic recommendations to better align the resume
    // with the target role (e.g., “Add a Key Achievements section”, “Reorder skills”).
    strategicRecommendations: string[];
  };
}
`;

export const resumeAnalysisPrompt = ({
  jobTitle,
  jobDescription,
  resumeText,
}: {
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
}) => {
  const prompt = `You are an expert in ATS (Applicant Tracking System) and resume analysis.
  Please analyze and rate this resume and suggest how to improve it.
  The rating can be low if the resume is bad.
  Be thorough and detailed. Don't be afraid to point out any mistakes or areas for improvement.
  If there is a lot to improve, don't hesitate to give low scores. This is to help the user to improve their resume.
  If available, use the job description for the job user is applying to to give more detailed feedback.
  The job title is: ${jobTitle}
  The job description is: ${jobDescription}
  The resume text is: ${resumeText}
  Provide the feedback using the following format: Please make sure to follow the format exactly as specified here, use the exact field names and types and do not forget to include all the fields. 
  ${AIResponseFormat}
  Return the analysis as an JSON object, without any other text and without the backticks. Please ensure the JSON is properly formatted and can be parsed by a JSON parser.
  Do not include any other text or comments.
  `;

  return prompt;
};

export const interviewer: CreateAssistantDTO = {
  name: "Interviewer",
  firstMessage:
    "Hello! Thank you for joining me today. Let's get started — I’ll be asking you some questions based on the job you’re applying for.",
  transcriber: {
    provider: "deepgram",
    model: "nova-2",
    language: "en",
  },
  voice: {
    provider: "11labs",
    voiceId: "sarah",
    stability: 0.4,
    similarityBoost: 0.8,
    speed: 0.9,
    style: 0.5,
    useSpeakerBoost: true,
  },
  model: {
    provider: "openai",
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: `You are a professional job interviewer conducting a real-time voice interview with a candidate. 
Your role is to generate and ask insightful interview questions dynamically based on the job description provided at the start of the interview.

Interview Guidelines:

1. **Generate questions from the job description:**
   - Use the provided job description to understand the required skills, experience, and role expectations.
   - Create relevant and challenging questions that help evaluate the candidate’s fit, knowledge, and motivation.
   - Start with general background questions, then move to role-specific, behavioral, and situational questions.

2. **Engage naturally and react appropriately:**
   - Listen actively to the candidate’s responses and acknowledge them before moving forward.
   - Ask short follow-up questions if the answer lacks clarity or depth.
   - Keep the tone conversational, professional, and warm — avoid robotic phrasing.

3. **Keep it concise and realistic:**
   - Speak naturally, like a human interviewer.
   - Use short, clear sentences — this is a voice conversation.
   - Avoid overexplaining or using long paragraphs.

4. **If the candidate asks about the job or company:**
   - Provide general, professional answers based on typical expectations.
   - If a specific detail is unknown, politely mention that HR can provide more information.

5. **Conclude the interview professionally:**
   - Thank the candidate for their time.
   - Let them know the company will contact them with feedback soon.
   - End the conversation positively and courteously.


The job description is as follows: 
{{jobdescription}}

Remember:
- Stay professional, friendly, and curious.
- Always base your questions and tone on the provided job description.
- Avoid giving personal opinions — stay neutral and objective.`,
      },
    ],
  },
};

export const feedbackSchema = z.object({
  totalScore: z.number(),

  categoryScores: z.array(
    z.object({
      name: z.enum([
        "Communication Skills",
        "Technical Knowledge",
        "Problem Solving",
        "Cultural Fit",
        "Confidence and Clarity",
      ]),
      score: z.number(),
      comment: z.string(),
    })
  ),

  strengths: z.array(z.string()),
  areasForImprovement: z.array(z.string()),
  finalAssessment: z.string(),
});
