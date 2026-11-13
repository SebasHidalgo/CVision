import { detectPostingLanguage } from "@/lib/ai/postingLanguage";
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

/** The CV's own word for a language it states a level of (in its clause, or in the four words before it: "Fluent English"), and where; null otherwise. */
function levelStated(cvText: string, pattern: string): { word: string; at: number } | null {
  const lines = cvText.split(/\r?\n/);
  let offset = 0;
  for (const [i, line] of lines.entries()) {
    // A wrapped Languages line: "German (B1," then "conversational)".
    const text = `${line} ${lines[i + 1] ?? ""}`;
    for (const match of text.matchAll(word(pattern, "giu"))) {
      if (match.index === undefined || match.index >= line.length) continue;
      const after = ownClause(text.slice(match.index + match[0].length, match.index + match[0].length + 60));
      const before = text.slice(0, match.index).split(/[,;|·]/).pop()?.trim().split(/\s+/).slice(-4).join(" ") ?? "";
      if (LANGUAGE_LEVEL.test(after) || LANGUAGE_LEVEL.test(before)) return { word: match[0], at: offset + match.index };
    }
    offset += line.length + 1;
  }
  return null;
}

/** Whether the CV states a level for the language. */
export function statesLevel(cvText: string, languageName: string): boolean {
  const language = LANGUAGES.find((one) => one.name === languageName);
  return Boolean(language && levelStated(cvText, language.pattern));
}

// Categories of languages ("another European language", "idioma extranjero"): the CV's own languages answer them, not the model's label.

type CategoryLanguage = Language & { european: boolean };

const NOT_EUROPEAN = new Set(["Chinese", "Japanese"]);
/** The languages a category can be answered with: the ones above, and more that only matter here. */
const CATEGORY_LANGUAGES: CategoryLanguage[] = [
  ...LANGUAGES.map((language) => ({ ...language, european: !NOT_EUROPEAN.has(language.name) })),
  { name: "Catalan", pattern: "catalan|catal[aá]n|catal[aà]", european: true },
  { name: "Polish", pattern: "polish|polaco", european: true },
  { name: "Russian", pattern: "russian|ruso", european: true },
  { name: "Ukrainian", pattern: "ukrainian|ucraniano", european: true },
  { name: "Swedish", pattern: "swedish|sueco", european: true },
  { name: "Danish", pattern: "danish|dan[eé]s", european: true },
  { name: "Norwegian", pattern: "norwegian|noruego", european: true },
  { name: "Finnish", pattern: "finnish|fin[eé]s|finland[eé]s", european: true },
  { name: "Greek", pattern: "greek|griego", european: true },
  { name: "Czech", pattern: "czech|checo", european: true },
  { name: "Romanian", pattern: "romanian|rumano", european: true },
  { name: "Hungarian", pattern: "hungarian|h[uú]ngaro", european: true },
  { name: "Arabic", pattern: "arabic|[aá]rabe", european: false },
  { name: "Korean", pattern: "korean|coreano", european: false },
  { name: "Hindi", pattern: "hindi", european: false },
  { name: "Hebrew", pattern: "hebrew|hebreo", european: false },
  { name: "Turkish", pattern: "turkish|turco", european: false },
];

const CATEGORY_EN =
  /(?<![\p{L}])(?:(?:an?other|a second|second|a third|third|an additional|additional|other|a foreign|foreign|one more)\s+(european\s+)?languages?|(european)\s+languages?)(?![\p{L}])/iu;
const CATEGORY_ES =
  /(?<![\p{L}])(?:(?:otr[oa]s?|segund[oa]|un segundo|una segunda|tercer[oa]?|alg[uú]n otro|alguna otra)\s+(?:idiomas?|lenguas?)(\s+europe[oa]s?)?|(?:idiomas?|lenguas?)\s+(?:adicional(?:es)?|extranjer[oa]s?|(europe[oa]s?)))(?![\p{L}])/iu;
const BARE_LANGUAGE = /^(?:languages?|idiomas?|lenguas?)$/iu;

/** Whether a key term names a category of languages rather than one language, and whether only European ones answer it. */
export function languageCategory(term: string, sourceQuote = ""): { european: boolean } | null {
  const read = (text: string) => {
    const match = CATEGORY_EN.exec(text) ?? CATEGORY_ES.exec(text);
    return match ? { european: match.slice(1).some((group) => Boolean(group)) } : null;
  };
  const own = read(term);
  if (own) return own;
  // The model sometimes names only the noun: the posting's own phrase says which languages.
  return BARE_LANGUAGE.test(term.trim()) ? read(sourceQuote) : null;
}

/** What the CV answers a language category with: its own word for each language that counts, in the CV's order; empty when it states none. */
export function categoryLanguagesInCv({ category, cvText, jobText }: { category: { european: boolean }; cvText: string; jobText: string }): { name: string; word: string }[] {
  // "Another" language is one beyond those the posting itself works in: the ones it names, and the one it is written in.
  const postingLanguage = jobText.trim() ? (detectPostingLanguage(jobText) === "es" ? "Spanish" : "English") : null;
  const taken = new Set(CATEGORY_LANGUAGES.filter((language) => language.name === postingLanguage || word(language.pattern).test(jobText)).map((language) => language.name));
  const found = CATEGORY_LANGUAGES.filter((language) => !taken.has(language.name) && (!category.european || language.european)).flatMap((language) => {
    const stated = levelStated(cvText, language.pattern);
    return stated ? [{ name: language.name, word: stated.word, at: stated.at }] : [];
  });
  return found.sort((a, b) => a.at - b.at).map(({ name, word: own }) => ({ name, word: own }));
}

/** Whether a CV word names a language at all: a match on one the posting already works in does not answer a category. */
export function namesLanguage(text: string): boolean {
  return CATEGORY_LANGUAGES.some((language) => word(language.pattern).test(text));
}
