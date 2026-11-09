import { DATE_RULE, QUOTE_RULES, REQUIREMENT_FIELDS, REQUIREMENT_RULES } from "@/lib/ai/prompts/cv-analysis.prompt";

/**
 * M8-F: the follow-up call when the analysis left qualification lines of the
 * posting uncovered (lib/ai/requirementCoverage.ts). Same entry shape and
 * rules as the analysis, so every requirement guard applies to its answer.
 */
export const requirementRepairPrompt = ({
  jobTitle,
  jobDescription,
  resumeText,
  lines,
  listed,
  today,
}: {
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
  /** The uncovered posting lines, verbatim. */
  lines: string[];
  /** The requirement texts the analysis already has. */
  listed: string[];
  /** As the analysis prompt states it. */
  today: string;
}) => `You are an expert in ATS (Applicant Tracking System) and resume analysis.
An analysis of this resume against this job posting skipped some lines of the posting's qualifications. Read each line and judge the requirements it holds against the resume.
Today's date is ${today}.
The job title is: ${jobTitle}
The job description is: ${jobDescription}
The resume text is: ${resumeText}

The lines the analysis skipped:
${lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}

The requirements the analysis already lists:
${listed.length ? listed.map((text, i) => `${i + 1}. ${text}`).join("\n") : "(none)"}

These rules override every other instruction here.

RULE 1 - Classify dates by comparing them with today, never by how they are phrased.
${DATE_RULE(today)}

RULE 2 - One requirement per requirement, and read its logic before judging it.
${REQUIREMENT_RULES}

RULE 3 - Cover the skipped lines, and only them.
- Return entries for the numbered skipped lines only, each with its sourceQuote copied from its line. Never return an entry for a requirement already listed.
- A skipped line that only restates or details a listed requirement (a specific check that a listed screening requirement names, a sentence repeating a listed skill) gets one entry whose requirement copies that listed requirement word for word.
- A skipped line that is not a requirement at all (the company, the team, a benefit) gets one entry with section "description".

RULE 4 - Quoted fields hold text copied out of the resume, or out of the job description for sourceQuote, heading, softenedClause.quote and keyTerms term.
${QUOTE_RULES}

Write every field in English, whatever language the resume or the job description is in; quoted fields stay verbatim in their own language.
Return a JSON object in exactly this format, with the exact field names and types:
{
  requirements: {
${REQUIREMENT_FIELDS}
  }[];
}
Return the JSON object only, without any other text and without backticks.
`;
