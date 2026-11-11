import { LANGUAGE_NAMES } from "@/lib/ai/requirementLanguages";
import type { ProseMap } from "@/lib/ai/translatableProse";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

/**
 * The terms a translation decides on: names stay verbatim everywhere, concepts are translated (in the
 * prose and in the code-made sentences that name them). The model classifies each term inside the
 * translation call; code forces the cases it can tell for certain. Pure; tested.
 */

export type TermKind = "name" | "concept";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-token match: "Go" is not in "Google", "C" is not in "CI". Case-sensitive unless flags say otherwise. */
export const tokenPattern = (term: string, flags = "u") => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, flags);

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);

const isLanguageName = (term: string) => LANGUAGE_NAMES.some((name) => name.toLowerCase() === term.toLowerCase());

// One word that reads as a name: a digit or symbol (C++, Node.js, CI/CD, 27001) or an inner capital (JavaScript).
// All capitals is not enough: "AI" is "IA" in Spanish; the model keeps SQL and AWS on its own.
const NAME_WORD = /[\p{N}+#./]|\p{Ll}\p{Lu}/u;

/**
 * A short term that is a name whatever the model says: every word of it reads as one (C++, Node.js,
 * PostgreSQL). "LinkedIn Profile" or "CI/CD Pipeline Context" holds a name but is not one.
 */
export function forcedName(term: string): boolean {
  const parts = words(term);
  return parts.length > 0 && parts.length <= 3 && parts.every((part) => NAME_WORD.test(part));
}

/** A term already written in the target language: nothing to translate (a Spanish posting's "comercio electrónico"). */
export function alreadyInTarget(term: string, locale: "es"): boolean {
  return locale === "es" && /[áéíóúñü¿¡]/iu.test(term);
}

// Most of its words capitalized: a title ("Add CI/CD Pipeline Context"), whose capitals say nothing about names.
const isTitle = (text: string) => {
  const long = words(text).filter((word) => /^\p{L}{4,}/u.test(word));
  return long.length >= 2 && long.length <= 12 && long.filter((word) => /^\p{Lu}/u.test(word)).length / long.length >= 0.7;
};

/**
 * The M9 rule, kept to compare against the model's classification: a digit or symbol, a capital past
 * the first letter, or one capitalized word the sources use mid-sentence.
 */
export function ruleKind(term: string, sources: string[]): TermKind {
  if (isLanguageName(term)) return "concept";
  if (/[\p{N}+#./]/u.test(term) || /.\p{Lu}/u.test(term)) return "name";
  if (!/^\p{Lu}\p{Ll}+$/u.test(term)) return "concept";
  const midSentence = new RegExp(`\\p{Ll}[,;:]?\\s+${escape(term)}(?![\\p{L}\\p{N}])`, "u");
  return sources.some((text) => midSentence.test(text)) ? "name" : "concept";
}

// Capitalized words, joined by the connectors names use: "University of Leeds", "Ruby on Rails".
const CAPITALIZED_RUN = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{N}+#.\-/']*(?:\s+(?:of|on|for|de|del|&)\s+\p{Lu}[\p{L}\p{N}+#.\-/']*|\s+\p{Lu}[\p{L}\p{N}+#.\-/']*)*/gu;
const QUOTED = /"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|«[^»\n]*»|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;

/** Capitalized runs the prose uses mid-sentence: the names nothing else lists (an institution, a person, a product). */
export function proseNameCandidates(sources: ProseMap): string[] {
  // Sentence by sentence, so a run never joins the end of one sentence to the start of the next ("AWS. To").
  const sentences = Object.values(sources)
    .filter((text) => !isTitle(text))
    .map((text) => text.replace(QUOTED, (quoted) => " ".repeat(quoted.length)))
    // A semicolon does not start a sentence: "…; Microsoft's stack" is mid-sentence.
    .flatMap((text) => text.split(/(?<=[.!?:])\s+/u));
  const midSentence = new Set<string>();
  const runs: Array<{ run: string; start: boolean }> = [];
  for (const sentence of sentences) {
    for (const match of sentence.matchAll(CAPITALIZED_RUN)) {
      const before = sentence.slice(0, match.index).trimEnd();
      const start = before === "" || /[(\-–—•]$/u.test(before);
      const run = match[0].replace(/['’]s$/u, "").replace(/[.,'\-/]+$/u, "");
      runs.push({ run, start });
      if (!start) midSentence.add(words(run)[0]);
    }
  }
  const found = new Set<string>();
  for (const { run, start } of runs) {
    const parts = words(run);
    // A sentence's first word is capitalized anyway: keep it only when the prose capitalizes it elsewhere too.
    const kept = start && !midSentence.has(parts[0]) && !forcedName(parts[0]) ? parts.slice(1) : parts;
    while (kept.length && /^(?:of|on|for|de|del|&)$/.test(kept[0])) kept.shift();
    const candidate = kept.join(" ");
    if (candidate.length >= 2 && !isLanguageName(candidate)) found.add(candidate);
  }
  return [...found];
}

const MAX_TERMS = 100;

/**
 * Every term one translation decides on, sentence terms first (their translation renders the
 * code-made sentences), then the analysis' own words that the prose contains: key terms, CV words,
 * matched skills, `always` (the company, the job title), and the prose's capitalized runs.
 */
export function translationTerms(
  feedback: Pick<ResumeAnalysisFeedback, "jobFit" | "skills"> | null,
  always: string[],
  sources: ProseMap,
  sentenceTerms: string[] = [],
): string[] {
  const texts = Object.values(sources);
  const inProse = (term: string) => texts.some((text) => tokenPattern(term).test(text));
  const listed = new Set<string>();
  for (const requirement of feedback?.jobFit.requirements ?? []) {
    for (const term of requirement.keyTerms?.terms ?? []) {
      listed.add(term.term.trim());
      listed.add(term.cvMatch.trim());
    }
  }
  for (const skill of feedback?.skills.matchedSkills ?? []) listed.add(skill.name.trim());
  for (const term of always) listed.add(term.trim());
  for (const term of proseNameCandidates(sources)) listed.add(term);
  const fromProse = [...listed]
    .filter((term) => term.length >= 1 && term.length <= 60 && !isLanguageName(term) && inProse(term))
    .sort((a, b) => b.length - a.length);
  return [...new Set([...sentenceTerms.filter((term) => term.trim()), ...fromProse])].slice(0, MAX_TERMS);
}
