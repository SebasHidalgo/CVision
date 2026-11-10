import { normalizeWhitespace } from "@/lib/ai/analysisChecks";
import type { Intervention } from "@/lib/ai/analysisGuardrails";
import { WORDING, type AnalysisLanguage } from "@/lib/ai/analysisWording";
import { absentTerms, alternativeNote, containsTerm, gapLabel, isSkillYears, unshowableAlternativeIn } from "@/lib/ai/requirementGuardrails";
import { languagesAsked } from "@/lib/ai/requirementLanguages";
import { yearsNote } from "@/lib/ai/requirementYears";
import type { Requirement } from "@/lib/schemas/resumeSchema";

// M8-G: the prose that states requirement outcomes, written from the final statuses like the headline. Pure; tested.

// More gap sentences than this read as a second copy of the list below them.
const MAX_GAP_SENTENCES = 4;

const shown = (requirement: Requirement) => (requirement.keyTerms?.terms ?? []).filter((term) => normalizeWhitespace(term.cvMatch)).map((term) => term.term);

/** One sentence on a required item that is missing or partly shown, from its terms or years. */
function gapSentence(requirement: Requirement, language: AnalysisLanguage): string {
  const words = WORDING[language];
  const years = requirement.years;
  if (years && years.candidate < years.min && !isSkillYears(requirement)) return yearsNote(years.min, years.candidate, language);
  const absent = absentTerms(requirement.keyTerms, requirement.sourceQuote, language);
  const has = shown(requirement);
  if (absent && has.length) return words.shownButNot(has.join(` ${words.and} `), absent);
  if (absent) return (requirement.keyTerms?.mode === "any" && (requirement.keyTerms?.terms.length ?? 0) > 1 ? words.noneOf : words.notShown)(absent);
  const label = gapLabel(requirement, language);
  return requirement.status === "partial" ? words.partlyMet(label) : words.notShown(label);
}

/** The outcome sentences of jobFit.description: how many required items are shown, the gaps, and what no CV shows. */
export function outcomeSentences(requirements: Requirement[], language: AnalysisLanguage = "en"): string[] {
  const words = WORDING[language];
  const required = requirements.filter((requirement) => requirement.kind === "required");
  const judged = required.filter((requirement) => requirement.status !== "not_evident");
  if (required.length === 0) return [];
  const sentences: string[] = [];
  if (judged.length) sentences.push(words.showsOf(judged.filter((requirement) => requirement.status === "met").length, judged.length));
  const gaps = judged.filter((requirement) => requirement.status === "missing" || requirement.status === "partial");
  sentences.push(...gaps.slice(0, MAX_GAP_SENTENCES).map((requirement) => gapSentence(requirement, language)));
  if (gaps.length > MAX_GAP_SENTENCES) sentences.push(words.moreInList(gaps.length - MAX_GAP_SENTENCES));
  let forInterview = 0;
  for (const requirement of required.filter((one) => one.status === "not_evident")) {
    const alternative = unshowableAlternativeIn(requirement.sourceQuote ?? "");
    if (alternative) sentences.push(alternativeNote(requirement, alternative, language));
    // A language level is the one thing here a CV can state: the same advice as its note.
    else if (languagesAsked(requirement).length) sentences.push(words.languageLevel(languagesAsked(requirement)[0]));
    else forInterview += 1;
  }
  if (forInterview) sentences.push(words.forInterview(forInterview));
  const preferred = requirements.filter((requirement) => requirement.kind === "preferred" && requirement.status === "missing").map((requirement) => preferredLabel(requirement, language));
  if (preferred.length) sentences.push(words.preferredNotShown(preferred.join("; ")));
  return sentences;
}

// A sentence states an outcome when it says whether something is there: met, aligned, missing, a gap.
const OUTCOME_WORD =
  /\b(?:gaps?|lacks?|lacking|missing|absent|short of|falls? short|not (?:mention|show|list|demonstrat|includ|highlight)\w*|(?:doesn|does not|don|do not)'?t? (?:mention|show|list|include|demonstrate)|no (?:mention|evidence|experience)|meets?|matches|aligns?|aligned|alignment|satisf\w+|strong (?:fit|match)|fulfil\w*|address(?:es)?|covers?|requested|requires?|asks? for|years)\b/i;

// A claim about the fit as a whole: "aligns with the requirements", "addresses the core qualifications".
const OVERALL_FIT = /\b(?:requirements?|qualifications?|criteria|the (?:role|position)|this (?:role|position))\b/i;

/** The words that name a requirement in prose: its key terms, and the first word of a multi-word name ("Ruby" of "Ruby on Rails"). */
function names(text: string, requirement: Requirement): boolean {
  return (requirement.keyTerms?.terms ?? []).some((term) => {
    if (containsTerm(text, term.term)) return true;
    const [first, ...rest] = normalizeWhitespace(term.term).split(" ");
    return rest.length > 0 && first.length >= 3 && /^\p{Lu}/u.test(first) && containsTerm(text, first);
  });
}

const CONNECTIVE = /^(?:furthermore|additionally|moreover|however|also|in addition|that said|still|besides|además|sin embargo|también),\s*/iu;

const sentencesOf = (text: string) => normalizeWhitespace(text).split(/(?<=[.!?])\s+(?=[\p{Lu}"“(])/u).filter(Boolean);

/**
 * jobFit.description with the outcomes written in code first; of the model's prose, only the sentences
 * that state no requirement's outcome stay, so the paragraph cannot contradict the list under it.
 */
export function withOutcomeProse(description: string, requirements: Requirement[], language: AnalysisLanguage = "en"): { description: string; interventions: Intervention[] } {
  const outcomes = outcomeSentences(requirements, language);
  if (outcomes.length === 0) return { description, interventions: [] };
  const interventions: Intervention[] = [];
  const kept: string[] = [];
  let dropped = false;
  for (const sentence of sentencesOf(description)) {
    const states =
      OUTCOME_WORD.test(sentence) &&
      (/\d+\+?\s*(?:years|años)/i.test(sentence) || OVERALL_FIT.test(sentence) || requirements.some((requirement) => names(sentence, requirement)));
    if (states) {
      interventions.push({ check: "prose", action: "sentence-dropped", path: "jobFit.description", value: sentence });
      dropped = true;
      continue;
    }
    // "Furthermore, …" no longer follows what it added to.
    kept.push(dropped ? sentence.replace(CONNECTIVE, "").replace(/^\p{Ll}/u, (letter) => letter.toUpperCase()) : sentence);
    dropped = false;
  }
  return { description: [...outcomes, ...kept].join(" "), interventions };
}

// Words that treat a thing as absent; "your certification" or "highlight" do not.
const IMPLIES_GAP = /\b(?:gaps?|lacks?|lacking|missing|(?:start|begin) learning|learn (?:it|them|the basics)|take a course|gain (?:experience|exposure|skills)|build (?:experience|skills) (?:in|with)|get (?:experience|certified)|upskill\w*|close the gap|no experience)\b/i;
const OFFERS_WILLINGNESS = /\b(?:willing\w*|eager to learn|open to learn\w*|keen to learn|readiness to learn|disposici\p{L}+|ganas de aprender)\b/iu;

/**
 * Drops a recommendation that contradicts the statuses: one that treats a met requirement as a gap,
 * or offers willingness to learn for a requirement whose posting accepts no such alternative.
 */
export function guardRecommendations(recommendations: string[], requirements: Requirement[]): { recommendations: string[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const kept = recommendations.filter((recommendation, i) => {
    const named = requirements.filter((requirement) => names(recommendation, requirement));
    const metAsGap = IMPLIES_GAP.test(recommendation) && named.some((requirement) => requirement.status === "met" && !named.some((other) => other.status !== "met"));
    const willingness =
      OFFERS_WILLINGNESS.test(recommendation) && named.some((requirement) => requirement.status !== "met" && !unshowableAlternativeIn(requirement.sourceQuote ?? ""));
    if (!metAsGap && !willingness) return true;
    interventions.push({
      check: "prose",
      action: "recommendation-dropped",
      path: `jobFit.strategicRecommendations[${i}]`,
      value: recommendation,
      replacement: metAsGap ? "a met requirement as a gap" : "willingness the posting does not accept",
    });
    return false;
  });
  return { recommendations: kept, interventions };
}

// "would help but is not essential", "is a plus": the softening words, not the thing preferred.
const SOFTENING_TAIL = /\s+(?:would (?:help|be (?:a plus|great|nice|an advantage))|is (?:a (?:plus|bonus)|nice to have|an advantage|preferred|desirable)|(?:es|sería) (?:un plus|deseable|valorable))\b.*$/iu;

/** A preferred item's short name: its absent terms, or its text up to its softening words. */
function preferredLabel(requirement: Requirement, language: AnalysisLanguage): string {
  if (absentTerms(requirement.keyTerms, requirement.sourceQuote, language)) return gapLabel(requirement, language);
  const text = requirement.requirement.replace(SOFTENING_TAIL, "");
  return gapLabel({ ...requirement, requirement: text }, language);
}
