const AIResponseFormat = `
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

    // List of missing skills from the job description.
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

/**
 * Two things here are deliberate and were paid for in M2c-E, 15 measured runs
 * over 5 wordings. Do not "improve" either without re-running the eval.
 *
 * Rule 2's metric paragraph describes what good feedback looks like instead of
 * ordering a search. Two attempts at the direct form ("scan every bullet, then
 * report what you found") never once got the model to name the figure the
 * resume does contain - it cannot reliably find it - and the second was worse
 * than the first.
 *
 * Rule 3 lists forbidden word-quantities in one short clause. Expanding that
 * into its own emphatic paragraph did stop the digits, but it cost the hedge
 * in rule 2: with the long version the model called metrics absent outright in
 * 8 of 9 runs, against 0 of 6 without it. Weight spent on one rule is taken
 * from another.
 *
 * The rules sit between the inputs and the response format, not at the top:
 * the resume and the job description can be long, and a constraint stated
 * before 150,000 characters of input is a constraint the model reads first and
 * applies last. Each one answers a failure measured by `npm run eval` against
 * the fixtures, so none of them is here on principle alone.
 */
const ANALYSIS_RULES = (today: string) => `
These five rules override every other instruction here, including the comments
in the response format below. An answer that breaks one of them is wrong even
if every field is filled in.

RULE 1 - Classify dates by comparing them with today, never by how they are phrased.
Today is ${today}. Before calling any degree, course, certification or role
ongoing, current, in progress, expected or unfinished, compare its end date
with today's date. An end date on or before today is finished, however recent
it is. Only an end date after today, or the words "Present", "Current" or "to
date" in the resume itself, mean ongoing. An entry with no end date at all is
missing its end date: say that, and do not infer that it is ongoing.

RULE 2 - Search the resume before claiming anything is absent from it.
Saying the resume lacks something is a claim about the whole resume, so read
the whole resume before making it. Finding one instance makes the claim false.
- Metrics are where this goes wrong most often. "No quantified results",
  "lacks measurable achievements", "absence of metrics" and any equivalent are
  false if the resume contains even one number that measures an outcome. When
  exactly one bullet is quantified, the correct feedback names that bullet as
  the model to follow and says the others do not follow it yet.
- skills.missingSkills, jobFit.missingKeywords and
  educationAndCertifications.recommendedCerts may only hold things that do not
  appear in the resume at all. Check each item against the resume text before
  you add it. A skill named in a skills section is present even if no bullet
  elaborates on it; if it is thinly evidenced, say so in the description
  instead of calling it missing.

RULE 3 - Never invent a number.
Every number in experienceAndImpact.suggestedBullets must either come from the
resume or be an empty placeholder for the candidate to fill in, written as
[X]%, [N] or [$X] with nothing inside the brackets. A plausible figure is not
an illustration, it is a fabrication: the candidate pastes the bullet into a
real application and is asked about it in an interview. Never write "by 35%",
"to 100%", "zero downtime", "thousands of users" or any other quantity, in
digits or in words, that the resume does not contain.

RULE 4 - Read the logic of a requirement before calling anything a gap.
- "A, B, C, or D", "one of A, B, C" and "including, but not limited to, A, B,
  C" are satisfied by any single item. If the resume has one of them the
  requirement is met, and the rest of that list are not gaps: they must not
  appear in missingSkills or missingKeywords.
- "A and B" needs both, so whichever is absent is a real gap.
- "Preferred", "nice to have", "a plus" and "bonus" are not required. Their
  absence is an opportunity at most, and must be described as optional.
- A gap is something the job genuinely requires that the resume genuinely does
  not have. Report every one of those: the goal is accuracy, not a short list.

RULE 5 - Evidence fields hold text copied out of the resume and nothing else.
This covers atsCompatibility.evidence and the evidence of every entry in
skills.matchedSkills.
- Copy one continuous span of the resume character for character: same words,
  same order, same case, same punctuation, same spelling. Prefer the shortest
  span that makes the point, usually a single line.
- Do not paraphrase, summarize or explain. "Listed under Databases", "Also
  mentioned in the Languages section" and "Demonstrated through API ownership"
  are descriptions, not quotes, and do not belong in these fields.
- Add nothing of your own: no ellipsis, no "...", no square brackets, no label
  before the text, no comment after it.
- Never join text from two different places into one quote.
- Never clean the text up. If a character is broken or mis-encoded in the
  resume text, reproduce it exactly as it is; repairing it hides the problem
  from the candidate and makes the quote false.
- If there is nothing you can copy, use an empty string. An empty evidence
  field is better than a description.
`;

/** UTC, unambiguous in both directions: a machine date and a written one. */
const formatToday = (now: Date) =>
  `${now.toISOString().slice(0, 10)} (${now.toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  })})`;

export const resumeAnalysisPrompt = ({
  jobTitle,
  jobDescription,
  resumeText,
  now,
}: {
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
  /** Resolved per request, so the date anchor is never baked in at build time. */
  now: Date;
}) => {
  const today = formatToday(now);

  const prompt = `You are an expert in ATS (Applicant Tracking System) and resume analysis.
  Please analyze and rate this resume and suggest how to improve it.
  The rating can be low if the resume is bad.
  Be thorough and detailed. Don't be afraid to point out any mistakes or areas for improvement.
  If there is a lot to improve, don't hesitate to give low scores. This is to help the user to improve their resume.
  If available, use the job description for the job user is applying to to give more detailed feedback.
  Today's date is ${today}.
  The job title is: ${jobTitle}
  The job description is: ${jobDescription}
  The resume text is: ${resumeText}
  ${ANALYSIS_RULES(today)}
  Provide the feedback using the following format: Please make sure to follow the format exactly as specified here, use the exact field names and types and do not forget to include all the fields.
  ${AIResponseFormat}
  Return the analysis as an JSON object, without any other text and without the backticks. Please ensure the JSON is properly formatted and can be parsed by a JSON parser.
  Do not include any other text or comments.
  `;

  return prompt;
};
