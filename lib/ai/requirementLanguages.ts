import type { Requirement } from "@/lib/schemas/resumeSchema";

// Language proficiency (owner decision, M8-D): met only when the CV states a level. Pure; tested.

type Language = { name: string; pattern: string };

const LANGUAGES: Language[] = [
  { name: "English", pattern: "english|ingl[eé]s" },
  { name: "Spanish", pattern: "spanish|espa[nñ]ol|castellano" },
  { name: "German", pattern: "german|alem[aá]n|deutsch" },
  { name: "French", pattern: "french|franc[eé]s|fran[cç]ais" },
  { name: "Portuguese", pattern: "portuguese|portugu[eéê]s" },
  { name: "Italian", pattern: "italian|italiano" },
  { name: "Dutch", pattern: "dutch|neerland[eé]s|holand[eé]s" },
  { name: "Chinese", pattern: "chinese|mandarin|mandar[ií]n|chino" },
  { name: "Japanese", pattern: "japanese|japon[eé]s" },
];

/** The language names the code knows, in English: a translation must translate them ("English" → "inglés"). */
export const LANGUAGE_NAMES: readonly string[] = LANGUAGES.map((language) => language.name);

const word = (pattern: string, flags = "iu") => new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, flags);

/** A stated level: CEFR, a named level, or a test. */
export const LANGUAGE_LEVEL = word(
  "[abc][12]\\+?|native|nativ[oa]|mother tongue|lengua materna|fluent|fluency|fluid[oa]|bilingual|biling[uü]e|advanced|avanzad[oa]|upper[- ]intermediate|intermediate|intermedi[oa]|basic|b[aá]sic[oa]|beginner|elementary|proficient|proficiency|conversational|conversacional|toefl|ielts|toeic|cambridge|fce|cae|cpe|dele|first certificate",
);

// Words that make a mention of a language a demand on its level; "writes clearly in English" is not one.
const PROFICIENCY =
  /fluen|proficien|level|nivel|nativ|bilingu|biling|(?<![\p{L}])[abc][12](?![\p{L}])|dominio|conversational|conversacional|advanced|avanzad|intermedi/iu;

/** The languages a requirement asks a level of; empty when it is not a language-proficiency requirement. */
export function languagesAsked(requirement: Pick<Requirement, "requirement" | "sourceQuote">): string[] {
  const text = `${requirement.requirement} ${requirement.sourceQuote ?? ""}`;
  const named = LANGUAGES.filter((language) => word(language.pattern).test(text));
  if (named.length === 0) return [];
  // "Portugués." or "Inglés profesional" asks for the language; anything longer has to say it is about a level.
  const others = named
    .reduce((rest, language) => rest.replace(word(language.pattern, "giu"), " "), requirement.requirement)
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  return others.length <= 1 || PROFICIENCY.test(text) ? named.map((language) => language.name) : [];
}

/** The text after a language name up to the next separator outside parentheses: "(B2, written and spoken)". */
function ownClause(after: string): string {
  let depth = 0;
  for (const [i, char] of [...after].entries()) {
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[,;|·]/.test(char)) return after.slice(0, i);
  }
  return after;
}

/** Whether the CV states a level for the language: in its own clause, or in the four words before it ("Fluent English"). */
export function statesLevel(cvText: string, languageName: string): boolean {
  const language = LANGUAGES.find((one) => one.name === languageName);
  if (!language) return false;
  const lines = cvText.split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    // A wrapped Languages line: "German (B1," then "conversational)".
    const text = `${line} ${lines[i + 1] ?? ""}`;
    for (const match of text.matchAll(word(language.pattern, "giu"))) {
      if (match.index === undefined || match.index >= line.length) continue;
      const after = ownClause(text.slice(match.index + match[0].length, match.index + match[0].length + 60));
      const before = text.slice(0, match.index).split(/[,;|·]/).pop()?.trim().split(/\s+/).slice(-4).join(" ") ?? "";
      if (LANGUAGE_LEVEL.test(after) || LANGUAGE_LEVEL.test(before)) return true;
    }
  }
  return false;
}
