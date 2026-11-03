/**
 * The posting-only extraction call of the two-call experiment (M8-A). The
 * posting travels as numbered lines and the answer has to account for every
 * one of them, so an omission has nowhere to hide: a line is either the
 * source of a requirement or labelled with why it is not one. Every
 * requirement names its lines and quotes its source verbatim, which the
 * caller checks in code. Nothing in production calls this yet.
 */

export type NumberedLine = { number: number; text: string };

/** Non-blank lines, trimmed, numbered from 1. Blank lines carry nothing to account for. */
export function numberLines(posting: string): NumberedLine[] {
  return posting
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text, index) => ({ number: index + 1, text }));
}

export const LINE_ROLES = ["requirement", "heading", "description", "responsibility", "benefit", "boilerplate", "condition"] as const;

export type LineRole = (typeof LINE_ROLES)[number];

const RESPONSE_FORMAT = `
{
  // One entry per numbered line of the posting, every line exactly once, in order.
  lines: {
    line: number;

    // "requirement": the line states something the candidate must have or be
    //   able to do (it may hold several requirements, or share one with the
    //   next line when a bullet wraps).
    // "heading": a section title or the job title.
    // "description": the company, the team, the product, the role in prose
    //   that demands nothing of the candidate.
    // "responsibility": what the person will do on the job. A responsibility
    //   that in the same sentence demands prior experience ("so you have
    //   shipped X before") is a "requirement".
    // "benefit": salary, equity, leave, perks, office days, remote policy.
    // "boilerplate": equal-opportunity text, the hiring process, how to
    //   apply, start dates, legal notices.
    // "condition": a condition of the job that is not a qualification: an
    //   on-call rotation, location, hours. A condition the candidate must
    //   meet to be hired (work authorization, a background check they must
    //   pass) is a "requirement".
    role: "requirement" | "heading" | "description" | "responsibility" | "benefit" | "boilerplate" | "condition";

    // The ids of the requirements this line is a source of. Empty unless
    // role is "requirement".
    requirementIds: string[];
  }[];

  requirements: {
    // "r1", "r2", ... in the order the posting states them.
    id: string;

    // The requirement in one line, as the posting puts it. Alternatives stay
    // inside the one entry: "Go, Java or Kotlin" is ONE requirement.
    requirement: string;

    // "required" if the posting presents it as a minimum or required
    // qualification; "preferred" if it is listed as preferred, desired, a
    // plus, a bonus, nice to have, or softened with "ideally" or
    // "preferably". The posting's own framing decides.
    kind: "required" | "preferred";

    // The numbered line(s) it comes from.
    lines: number[];

    // The posting text it comes from, copied character for character from
    // those lines: one continuous span, no ellipsis, no paraphrase.
    quote: string;
  }[];
}
`;

const RULES = `
RULE 1 - Account for every line. Every numbered line appears exactly once in
"lines". A line that holds a requirement has role "requirement" and names the
ids of the requirements it is a source of; every other line names why it is
not one. Do not skip lines and do not invent line numbers.

RULE 2 - One requirement per requirement.
- "A, B, C, or D", "one of A, B, C" and "including, but not limited to, A, B,
  C" are ONE requirement that any single item satisfies. Never one per
  alternative.
- "A degree or equivalent experience" is ONE requirement; the equivalence is a
  second way to satisfy it, not a second item and not a preferred one.
- "A and B" is one requirement that needs both.
- A requirement the posting states twice (a closing paragraph that repeats a
  must-have) is one requirement with both lines as its sources.
- Years attached to a skill belong to that skill's requirement; years
  attached to the role as a whole are their own requirement.
- Examples in parentheses are part of the capability, not separate items.

RULE 3 - The posting's own framing decides "kind". Required, minimum, must
have, what we need, what we are looking for, requirements: "required".
Preferred, desired, nice to have, a plus, a bonus, it helps if, it would be
great if, ideally, preferably, would help but is not essential: "preferred".
A clause that softens one part of a required bullet ("ideally in e-commerce",
"preferably Power BI") is its own preferred requirement beside the required
one.

RULE 4 - Benefits, the company's story, the hiring process and responsibilities
are not requirements, unless a sentence demands a capability the candidate
must already have. A soft skill the posting states as a demand ("you explain
trade-offs clearly") is a requirement.

RULE 5 - Cover every requirement the posting states, required and preferred.
The goal is a complete and exact list, not a short one.

RULE 6 - "quote" holds posting text and nothing else: one continuous span
copied character for character from the lines named. No paraphrase, no
ellipsis, no added words. A requirement whose quote is not in the posting is
discarded.
`;

export const requirementExtractionPrompt = ({ jobTitle, lines }: { jobTitle: string; lines: NumberedLine[] }) => `You extract the requirements of a job posting for a candidate who wants to know exactly what the posting asks for.
The job title is: ${jobTitle}
The posting, one numbered line at a time:
${lines.map((line) => `${line.number}: ${line.text}`).join("\n")}
${RULES}
Answer with a JSON object in exactly this format, with these field names and types and nothing else:
${RESPONSE_FORMAT}
Return the JSON object only, without backticks or any other text.
`;
