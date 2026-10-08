/**
 * The field comments below are instructions the model follows, not
 * documentation. M2c-F audited them against the rules and removed three that
 * licensed what a rule forbids: `weaknesses` offered "No metrics provided" as
 * an example of a good weakness, which is the exact absolute rule 2 bans;
 * `suggestedBullets` asked for "quantifiable results", which is an invitation
 * to invent the figure rule 3 bans; and `improvements` offered "Add graduation
 * year" for a resume that may already have one. Adding an example here is
 * adding an instruction - check it against the rules first.
 */
const AIResponseFormat = `
{
  overall: {
    // How COMPETITIVE this application is, 0-100. Not whether the candidate
    // clears the bar: jobFit.requirements answers that item by item, and a
    // number repeating it is worth nothing. Clearing every required
    // qualification is the entry condition, not a high score; the preferred
    // ones separate one candidate from the pile. Count your own list:
    //   85-100  bar cleared, and most of the preferred ones met
    //   70-84   bar cleared, and a third to two thirds of the preferred ones
    //   50-69   bar cleared, under a third of the preferred ones - qualified
    //           and nothing more, which is where most applicants belong
    //   25-49   a required qualification missing, or several only partial
    //   0-24    a different profession
    fitScore: number;

    // How good this resume is as a document, 0-100, ignoring this posting
    // entirely. This is the score the candidate can change by editing, and it
    // carries to every application they make.
    //   85-100  nearly every bullet states an outcome with a figure; dates and
    //           tense consistent; clean sections; no extraction artifacts
    //   70-84   most bullets state outcomes and several carry figures; minor
    //           formatting inconsistencies
    //   50-69   sections and structure are fine, but most bullets describe
    //           duties rather than outcomes and few carry a figure. This is
    //           the ordinary case for a working resume - do not reach past it
    //           out of politeness
    //   25-49   no measurable outcome anywhere, vague descriptions, or
    //           formatting that breaks text extraction
    //   0-24    not usable as a resume
    qualityScore: number;

    // 2-4 sentences. Lead with how the resume answers the posting's required
    // qualifications, then what would most improve the document itself.
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

  // What an ATS actually receives. The resume text you were given IS the
  // extracted text layer, so report what is in it rather than guessing about
  // the PDF you cannot see. No score: state facts and let the candidate act.
  atsCompatibility: {
    // At least 150 characters on what the extracted text shows about how this
    // document parses. Ground every statement in the text above.
    description: string;

    // Characters that came out of the PDF broken or mis-encoded, each quoted
    // exactly as it appears in the resume text, with enough of the surrounding
    // word to find it. Empty if the text layer is clean.
    encodingArtifacts: string[];

    // The section headings present in the resume text, copied as written.
    // Empty if the text has no recognizable headings.
    sectionsDetected: string[];

    // 2-4 problems that affect parsing, each one visible in the text above.
    // Do not list a problem the text does not show.
    problems: string[];

    // 2-4 actionable fixes for the problems listed. One per problem where you
    // can. Must not repeat recommendations from other sections.
    fixes: string[];

    // 1-3 short snippets copied from the resume that back up the analysis.
    evidence: string[];
  };

  experienceAndImpact: {
    // 0-100 for how the experience is written: outcomes over duties, clarity,
    // and whether results are quantified. Same bands as overall.qualityScore.
    score: number;

    // At least 150 characters analyzing how experience is presented.
    // Mention clarity, structure, and whether achievements are quantified.
    description: string;

    // Every measured outcome the resume ALREADY states: a number attached to a
    // result. Fill this in before writing anything in weaknesses about metrics
    // being absent. Empty only if no bullet anywhere in the resume carries one.
    quantifiedAchievements: {
      // The figure as the resume writes it, e.g. "40%", "3x", "12 services".
      figure: string;

      // The bullet it comes from, copied from the resume word for word.
      quote: string;
    }[];

    // 2-4 concrete strengths, focusing on writing style, metrics, or clarity.
    strengths: string[];

    // 2-4 specific weaknesses that limit impact. Each one has to be true of
    // this resume. If quantifiedAchievements above is not empty, a weakness
    // about metrics has to say how many there are or which parts lack them.
    weaknesses: string[];

    // Rewrite 1-3 real bullets from the most relevant role(s) to show better
    // phrasing. Keep every figure the original had; where a figure would help
    // but the resume does not have one, leave [X]% or [N] for the candidate.
    suggestedBullets: {
      // Job role name (e.g., “Marketing Manager”)
      role: string;

      // 1-3 rewritten bullet examples demonstrating better phrasing.
      examples: string[];
    }[];
  };

  skills: {
    // 0-100 for how clearly the resume presents the skills it has: grouping,
    // specificity, and whether bullets back them up. Not about this posting -
    // unmet requirements belong in jobFit.requirements.
    score: number;

    // At least 150 characters on how the skills are presented and evidenced.
    description: string;

    // Skills the posting asks for that the resume has, each with the text from
    // the resume that proves it.
    matchedSkills: { name: string; evidence: string }[];

    // 2-4 clear and actionable steps explaining how to improve the skills section.
    // Example: “Group technical skills by category”, “Add proficiency levels”.
    actionPlan: string[];
  };

  educationAndCertifications: {
    // 0-100 reflecting how strong and relevant the education and
    // certifications are for the job.
    score: number;

    // At least 120 characters describing degree relevance, visibility, and order.
    description: string;

    // 1-3 positive highlights (e.g., “Strong relevant degree”, “Certifications add credibility”).
    highlights: string[];

    // 1-3 specific, practical improvements. Each has to be something this
    // resume is actually missing - check the text before asking for it.
    improvements: string[];

    // Optional: certifications not in the resume that would strengthen it
    // (e.g., “AWS Certified Developer”). Leave empty rather than padding.
    recommendedCerts: string[];
  };

  toneAndClarity: {
    // 0-100 assessing tone, grammar, and overall readability.
    score: number;

    // At least 120 characters analyzing writing clarity and tone, including
    // sentence length, bullet length and consistency of voice.
    description: string;

    // 2-4 suggestions for tone and language improvements.
    // Example: “Avoid jargon”, “Use shorter sentences”, “Replace passive verbs”.
    suggestions: string[];
  };

  // The headline of the analysis: what the posting asks for, one entry per
  // requirement, and how this resume answers each one.
  jobFit: {
    // At least 150 characters summarizing how the resume answers the posting's
    // requirements, leading with the required ones.
    description: string;

    // One entry per requirement in the posting. Cover every required
    // qualification; include the preferred ones that matter.
    requirements: {
      // The requirement in one line, as the posting puts it. When the posting
      // offers alternatives, they belong INSIDE this one entry: "coding in C,
      // C++, C#, Java, JavaScript, GO or Python" is ONE requirement, never one
      // per language.
      requirement: string;

      // "required" if the posting presents it as a minimum or required
      // qualification; "preferred" if it is listed as preferred, desired, a
      // plus, a bonus or nice to have. Use the posting's own framing.
      kind: "required" | "preferred";

      // "met" when the resume satisfies it - for a list of alternatives, one
      // of them is enough. "partial" when the resume shows something adjacent
      // but not the thing asked for. "missing" when the resume shows nothing
      // for it.
      status: "met" | "partial" | "missing";

      // The text from the resume that decides the status, copied word for
      // word. Empty string when the status is "missing".
      evidence: string;

      // One sentence on why that status. For a list of alternatives, name the
      // one the candidate has. For "partial", say what is there and what is
      // not. Never describe an alternative the candidate lacks as a gap when
      // another alternative in the same requirement is met.
      note: string;
    }[];

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
 * than the first. M2c-F replaces the instruction with a field it has to fill,
 * which is a different task; the rule now only ties the two together.
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
  false if experienceAndImpact.quantifiedAchievements has even one entry. That
  list is the test: fill it from the resume first, and if it is not empty, any
  statement about metrics has to be qualified to match what is in it.
- educationAndCertifications.recommendedCerts and improvements may only hold
  things the resume does not already have. Check each one against the resume
  text before you add it. A skill named in a skills section is present even if
  no bullet elaborates on it; if it is thinly evidenced, say so in the
  description instead of treating it as absent.

RULE 3 - Never invent a number.
Every number in experienceAndImpact.suggestedBullets must either come from the
resume or be an empty placeholder for the candidate to fill in, written as
[X]%, [N] or [$X] with nothing inside the brackets. A plausible figure is not
an illustration, it is a fabrication: the candidate pastes the bullet into a
real application and is asked about it in an interview. Never write "by 35%",
"to 100%", "zero downtime", "thousands of users" or any other quantity, in
digits or in words, that the resume does not contain.

RULE 4 - One requirement per requirement, and read its logic before judging it.
jobFit.requirements is the only place a gap may appear in this analysis.
- "A, B, C, or D", "one of A, B, C" and "including, but not limited to, A, B,
  C" are ONE requirement that any single item satisfies. If the resume has one
  of them, that requirement is "met", and the alternatives the candidate lacks
  are not gaps: they must not appear as their own requirement, and nothing
  anywhere in the analysis may call them missing.
- "A and B" is one requirement that needs both. It is "partial" when only one
  is there.
- The posting's own framing decides "kind". Preferred, desired, a plus, a
  bonus and nice to have are all "preferred", never "required".
- Cover every required qualification the posting states. A requirement the
  resume genuinely does not answer is "missing" - report those plainly, the
  goal is accuracy, not a short list.

RULE 5 - Quoted fields hold text copied out of the resume and nothing else.
This covers atsCompatibility.evidence, atsCompatibility.encodingArtifacts,
atsCompatibility.sectionsDetected, the evidence of every entry in
skills.matchedSkills and jobFit.requirements, and the quote of every entry in
experienceAndImpact.quantifiedAchievements.
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
- If there is nothing you can copy, use an empty string. An empty quoted field
  is better than a description.
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
