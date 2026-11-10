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
  return requirement.status === "partial" ? words.partlyMet(label) : words.notShownAsAsked(label);
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

/** A requirement is named in prose by one of its key terms in full; "Ruby" alone does not name "Ruby on Rails" (M8-H). */
const names = (text: string, requirement: Requirement) => (requirement.keyTerms?.terms ?? []).some((term) => containsTerm(text, term.term));

const CONNECTIVE = /^(?:furthermore|additionally|moreover|however|also|in addition|that said|still|besides|además|sin embargo|también),\s*/iu;

const sentencesOf = (text: string) => normalizeWhitespace(text).split(/(?<=[.!?])\s+(?=[\p{Lu}"“(])/u).filter(Boolean);

// M8-H: a sentence that opens with what to do is advice ("To better align with this role, emphasize…", "Bringing… forward").
const ADVICE =
  /^(?:to\s+\p{L}+|consider\w*|bring(?:ing)?|add(?:ing)?|closing|highlight\w*|emphasi[sz]\w*|translat\w*|mention\w*|showcas\w*|lead with|mov(?:e|ing)|plac(?:e|ing)|quantify\w*|if you|you (?:can|could|should|may|might))\b/iu;
// What advice may claim only when the statuses agree: absence, a gap, a strong fit.
const ABSENT_CLAIM =
  /\b(?:absent|lack(?:s|ing)?|missing|no (?:mention|evidence|experience)|not (?:currently |yet )?(?:show|mention|list|evidence|include|demonstrat)\w*|(?:doesn|does not|don|do not)'?t? (?:currently |yet )?(?:show|mention|list|include|demonstrate|evidence)\w*)\b/i;
const GAP_CLAIM = /\bgaps?\b/i;
const STRONG_FIT = /\b(?:strong|close|tight|excellent|exceptional|great|solid)\s+(?:fit|match|alignment)\b|\balign(?:s|ed)?\s+(?:very |exceptionally |extremely )?(?:well|closely|strongly)\b/i;

/** No required item a CV can show is missing, and at most one is partial: the bar deriveFitVerdict uses. */
function clearsBar(requirements: Requirement[]): boolean {
  const judged = requirements.filter((requirement) => requirement.kind === "required" && requirement.status !== "not_evident");
  return !judged.some((requirement) => requirement.status === "missing") && judged.filter((requirement) => requirement.status === "partial").length <= 1;
}

/** Why a piece of advice contradicts the statuses, or null when it agrees with them. */
function adviceConflict(sentence: string, requirements: Requirement[]): string | null {
  const named = requirements.filter((requirement) => names(sentence, requirement));
  if (ABSENT_CLAIM.test(sentence) && named.some((requirement) => requirement.status === "met" || requirement.status === "partial")) return "calls a shown requirement absent";
  if (GAP_CLAIM.test(sentence) && named.length > 0 && named.every((requirement) => requirement.status === "met")) return "a met requirement as a gap";
  if (GAP_CLAIM.test(sentence) && named.some((requirement) => requirement.status === "not_evident")) return "a requirement no CV can show as a gap";
  if (STRONG_FIT.test(sentence) && !clearsBar(requirements)) return "a strong fit the required items do not show";
  if (offersUnacceptedWillingness(sentence, named)) return "willingness the posting does not accept";
  return null;
}

/**
 * jobFit.description with the outcomes written in code first. Of the model's prose, the sentences that state an
 * outcome go, and advice stays unless it contradicts the statuses, so the paragraph cannot contradict the list under it.
 */
export function withOutcomeProse(description: string, requirements: Requirement[], language: AnalysisLanguage = "en"): { description: string; interventions: Intervention[] } {
  const outcomes = outcomeSentences(requirements, language);
  if (outcomes.length === 0) return { description, interventions: [] };
  const interventions: Intervention[] = [];
  const kept: string[] = [];
  let dropped = false;
  for (const sentence of sentencesOf(description)) {
    const conflict = ADVICE.test(sentence) ? adviceConflict(sentence, requirements) : null;
    const states =
      !ADVICE.test(sentence) &&
      OUTCOME_WORD.test(sentence) &&
      (/\d+\+?\s*(?:years|años)/i.test(sentence) || OVERALL_FIT.test(sentence) || requirements.some((requirement) => names(sentence, requirement)));
    if (states || conflict) {
      interventions.push({ check: "prose", action: "sentence-dropped", path: "jobFit.description", value: sentence, ...(conflict ? { replacement: conflict } : {}) });
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
// Willingness to learn, not to relocate or travel: only the first is an alternative a posting may accept.
const OFFERS_WILLINGNESS =
  /\b(?:willing(?:ness)? to (?:learn|pick up|work with)|eager to learn|open to learn\w*|keen to learn|readiness to learn|disposici\p{L}+ (?:a|para) aprender|ganas de aprender)\b/iu;

/**
 * Drops a recommendation that contradicts the statuses: one that treats a met requirement as a gap,
 * or offers willingness to learn for a requirement whose posting accepts no such alternative.
 */
/** Willingness to learn offered for a named requirement whose posting accepts no such alternative. */
function offersUnacceptedWillingness(text: string, named: Requirement[]): boolean {
  return OFFERS_WILLINGNESS.test(text) && named.some((requirement) => requirement.status !== "met" && !unshowableAlternativeIn(requirement.sourceQuote ?? ""));
}

export function guardRecommendations(recommendations: string[], requirements: Requirement[]): { recommendations: string[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const kept = recommendations.filter((recommendation, i) => {
    const named = requirements.filter((requirement) => names(recommendation, requirement));
    const metAsGap = IMPLIES_GAP.test(recommendation) && named.some((requirement) => requirement.status === "met" && !named.some((other) => other.status !== "met"));
    // "Not shown in your CV" is outside the verdict: calling one a gap contradicts the page (M8-H).
    const notShownAsGap = GAP_CLAIM.test(recommendation) && named.some((requirement) => requirement.status === "not_evident");
    const willingness = offersUnacceptedWillingness(recommendation, named);
    if (!metAsGap && !notShownAsGap && !willingness) return true;
    interventions.push({
      check: "prose",
      action: "recommendation-dropped",
      path: `jobFit.strategicRecommendations[${i}]`,
      value: recommendation,
      replacement: metAsGap ? "a met requirement as a gap" : notShownAsGap ? "a requirement no CV can show as a gap" : "willingness the posting does not accept",
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
