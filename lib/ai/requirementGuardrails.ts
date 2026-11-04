import { groundQuotes, loosen, mentionsTerm, normalizeWhitespace } from "@/lib/ai/analysisChecks";
import { WORDING, type AnalysisLanguage } from "@/lib/ai/analysisWording";
import { spanFor, type Intervention } from "@/lib/ai/analysisGuardrails";
import { detectPostingLanguage } from "@/lib/ai/postingLanguage";
import { candidateYears, yearsIn, yearsNote, yearsStatus } from "@/lib/ai/requirementYears";
import type {
  EvidenceSource,
  KeyTerms,
  ModelRequirement,
  Requirement,
  RequirementStatus,
  ResumeAnalysisFeedback,
} from "@/lib/schemas/resumeSchema";

// M8-B and M8-C: the requirement fields the model fills, checked in code. Pure; tested.

/** Replaces the model's note when a status is downgraded, so the note never argues for the old one. */
export const DOWNGRADE_NOTE = WORDING.en.downgrade;

/** The posting's own softening words; a clause without one is an example, an alternative or a remark, not a preferred item. */
const SOFTENING =
  /\b(?:plus|ideal|ideally|prefer\w*|bonus|nice[\s-]to[\s-]have|desirabl\w*|advantage\w*|great|helps?|idealmente|preferiblemente|preferentemente|deseable|valorable|valora\w*|ventaja)\b/i;

/** "or willingness to learn", "or a clear appetite to learn it fast", "o disposición para aprenderlo": an alternative no CV can show. */
export const UNSHOWABLE_ALTERNATIVE =
  /(?:^|[\s,;(])((?:or|o|u)\s+(?:[\p{L}'-]+\s+){0,4}?(?:willing\p{L}*|eager\p{L}*|appetite|desire|interest\p{L}*|keen|motivat\p{L}*|ready|readiness|open(?:ness)?|curio\p{L}*|ganas|disposici\p{L}*|dispuest\p{L}*|inter[eé]s\p{L}*|voluntad|deseo|predisposici\p{L}*|motivaci\p{L}*)(?:\s+[\p{L}'-]+){0,6}?\s+(?:learn\p{L}*|pick\p{L}*\s+(?:it\s+|them\s+)?up|aprend\p{L}*|form[aá]rse|capacit\p{L}*)[^.;]*)/iu;

const PREFERRED_HEADING =
  /prefer|nice[\s-]to[\s-]have|bonus|plus|desirabl|desired|ideal|advantage|additional|valoramos|valorable|deseable|se valora|ventaja|great if/i;
const REQUIRED_WORD = /requir|must|minimum|mandatory|essential|requisitos|imprescindible|obligatori/i;
const QUALIFICATIONS_HEADING =
  /qualif|skills|what you (?:need|bring|have)|you (?:have|bring)|who you are|about you|buscamos|perfil/i;

/** The kind a verified heading states, or null when it states none or both ("Job Requirements: Other & Additional"). */
export function headingKind(heading: string): "required" | "preferred" | null {
  const preferred = PREFERRED_HEADING.test(heading);
  const required = REQUIRED_WORD.test(heading);
  if (preferred && required) return null;
  if (preferred) return "preferred";
  if (required || QUALIFICATIONS_HEADING.test(heading)) return "required";
  return null;
}

/** A posting's way of offering a choice or examples; without one, named terms are all required. */
const ALTERNATIVE_WORD = /(?:^|[^\p{L}])(?:or|o|u|either|such as|e\.g\.|for example|for instance|like|including|similar|equivalent|comparable|por ejemplo|como|similar|equivalente)(?:[^\p{L}]|$)|\//iu;

type Found = { text: string; normalized: boolean };

/** The quote as the posting has it: verbatim, or rewritten when only case or punctuation differ. */
function inPosting(posting: string, quote: string): Found | null {
  const text = normalizeWhitespace(quote);
  if (!text) return null;
  const [violation] = groundQuotes(posting, [{ path: "", value: text }]);
  if (!violation) return { text, normalized: false };
  if (violation.kind !== "case-or-punctuation") return null;
  const span = spanFor(posting, text);
  return span ? { text: span, normalized: true } : null;
}

/** Whole-token match, case-insensitive; typography ignored for terms of two letters or more. */
export function containsTerm(text: string, term: string): boolean {
  const wanted = normalizeWhitespace(term);
  if (!wanted) return false;
  if (mentionsTerm(normalizeWhitespace(text), wanted)) return true;
  const loose = loosen(wanted);
  return loose.length >= 2 && ` ${loosen(text)} `.includes(` ${loose} `);
}

const escapeForRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Separators and dangling conjunctions left at either end once a clause is cut out. */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/[,;:]\s*\./g, ".")
    .replace(/\s+/g, " ")
    .replace(/(?:[\s,;:.–—-]|\b(?:and|or|y|o)\b)+$/i, "")
    .replace(/^[\s,;:.–—-]+/, "")
    .trim();
}

/** The text with the clause cut out, or null when the clause is not in it or nothing would be left. */
export function withoutClause(text: string, clause: string): string | null {
  const words = normalizeWhitespace(clause).split(" ").filter(Boolean).map(escapeForRegex);
  if (words.length === 0) return null;
  const pattern = new RegExp(words.join("\\s+"), "i");
  if (!pattern.test(text)) return null;
  const rest = tidy(text.replace(pattern, " "));
  return rest.length >= 3 ? rest : null;
}

/** "ideally in e-commerce." -> "Ideally in e-commerce". */
export function clauseAsRequirement(clause: string): string {
  const text = clause.replace(/^[\s,;:.(–—-]+/, "").replace(/[\s,;:.)]+$/, "");
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

const fold = (word: string) => word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The posting text as a requirement line: no list marker, no closing punctuation. */
export function asRequirementText(quote: string): string {
  return quote.replace(/^[\s\-–—•*·]+/, "").replace(/[\s.;:,]+$/, "");
}

/** The requirement in the posting's spelling ("Portugués", not "Português") and language. */
export function alignToSource(requirement: string, source: string): string {
  const spelled = new Map<string, string>();
  for (const word of source.match(/\p{L}+/gu) ?? []) spelled.set(fold(word), word);
  const respelled = requirement.replace(/\p{L}+/gu, (word) => {
    const posting = spelled.get(fold(word));
    if (!posting || posting.toLowerCase() === word.toLowerCase()) return word;
    return word[0] === word[0].toUpperCase() ? posting[0].toUpperCase() + posting.slice(1) : posting;
  });
  if (detectPostingLanguage(respelled) !== detectPostingLanguage(source)) return asRequirementText(source);
  return respelled;
}

/** Context the status rules need beside the stored requirement, aligned by index. */
export type PendingRequirement = { yearsEvidence: string[] };

/** Before guardAnalysis: posting quote, section, softened clause, key terms and the requirement's wording. */
export function structureRequirements(
  posting: string,
  model: ModelRequirement[],
): { requirements: Requirement[]; pending: PendingRequirement[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const requirements: Requirement[] = [];
  const pending: PendingRequirement[] = [];
  const record = (intervention: Intervention) => interventions.push(intervention);

  // A clause the model also listed as its own preferred entry must not be added twice.
  const listedPreferred = model
    .filter((entry) => entry.kind === "preferred")
    .flatMap((entry) => [loosen(entry.sourceQuote), loosen(entry.requirement)])
    .filter(Boolean);

  model.forEach((entry, index) => {
    const path = `jobFit.requirements[${index}]`;

    const source = inPosting(posting, entry.sourceQuote);
    if (!source) {
      record({ check: "posting-source", action: "requirement-dropped", path: `${path}.sourceQuote`, value: entry.requirement });
      return;
    }
    if (source.normalized) {
      record({ check: "posting-source", action: "quote-normalized", path: `${path}.sourceQuote`, value: entry.sourceQuote, replacement: source.text });
    }
    // A heading not in the posting is noted and ignored; one after the quote is not its heading.
    const heading = normalizeWhitespace(entry.heading) ? inPosting(posting, entry.heading) : null;
    if (normalizeWhitespace(entry.heading) && !heading) {
      record({ check: "posting-source", action: "recorded", path: `${path}.heading`, value: entry.heading });
    }
    const flat = normalizeWhitespace(posting);
    const sourceAt = flat.indexOf(source.text);
    const ownHeading = heading && sourceAt >= 0 && flat.lastIndexOf(heading.text, sourceAt) >= 0 ? heading.text : null;

    // Company, team, stack and offer never; the work only when it demands a capability.
    const describesOnly =
      entry.section === "description" || (entry.section === "responsibilities" && !entry.demandsCapability);
    if (describesOnly) {
      record({ check: "posting-section", action: "requirement-dropped", path: `${path}.section`, value: entry.requirement, replacement: entry.section });
      return;
    }

    // Kind from the posting's own wording: its heading, or a softening word in the quote.
    const stated = ownHeading ? headingKind(ownHeading) : null;
    const softened = SOFTENING.test(source.text);
    let kind = entry.kind;
    if (kind === "preferred" && !softened && (stated === "required" || (stated === null && entry.section === "requirements"))) kind = "required";
    else if (kind === "required" && stated === "preferred") kind = "preferred";
    if (kind !== entry.kind) {
      record({ check: "posting-kind", action: "kind-changed", path: `${path}.kind`, value: entry.requirement, replacement: kind });
    }

    const requirement: Requirement = {
      requirement: entry.requirement,
      kind,
      status: entry.status,
      evidence: entry.evidence,
      note: entry.note,
      sourceQuote: source.text,
      section: entry.section,
      assessable: entry.assessable,
    };
    requirements.push(requirement);
    pending.push({ yearsEvidence: entry.yearsEvidence });

    let derived: Requirement | null = null;
    const clause = entry.softenedClause;
    if (kind === "required" && normalizeWhitespace(clause.quote)) {
      const found = inPosting(posting, clause.quote);
      if (!found || !SOFTENING.test(found.text)) {
        record({ check: "softened-clause", action: "recorded", path: `${path}.softenedClause.quote`, value: clause.quote, replacement: found ? "no softening word" : "not in posting" });
      } else if (loosen(found.text) === loosen(source.text)) {
        // The whole entry was the softened part: it is a preferred requirement.
        requirement.kind = "preferred";
        record({ check: "softened-clause", action: "kind-changed", path: `${path}.kind`, value: entry.requirement, replacement: "preferred" });
      } else {
        requirement.requirement = withoutClause(requirement.requirement, found.text) ?? requirement.requirement;
        const trimmed = withoutClause(source.text, found.text);
        const trimmedSource = trimmed ? inPosting(posting, trimmed) : null;
        if (trimmedSource) requirement.sourceQuote = trimmedSource.text;

        const key = loosen(found.text);
        if (listedPreferred.some((text) => text === key || text.includes(key))) {
          record({ check: "softened-clause", action: "recorded", path: `${path}.softenedClause.quote`, value: found.text, replacement: "already listed" });
        } else {
          derived = {
            requirement: clauseAsRequirement(found.text),
            kind: "preferred",
            status: clause.status,
            evidence: clause.evidence,
            note: clause.note,
            sourceQuote: found.text,
            section: entry.section,
            assessable: entry.assessable,
          };
          record({ check: "softened-clause", action: "requirement-split", path: `${path}.softenedClause`, value: found.text, replacement: derived.requirement });
        }
      }
    }

    const text = alignToSource(requirement.requirement, requirement.sourceQuote ?? source.text);
    if (text !== requirement.requirement) {
      record({ check: "requirement-text", action: "text-replaced", path: `${path}.requirement`, value: requirement.requirement, replacement: text });
      requirement.requirement = text;
    }

    // Each term stays with the quote it is in; a term in neither is dropped, and so is a number of years (the years rule owns those).
    const own: KeyTerms["terms"] = [];
    const clauseTerms: KeyTerms["terms"] = [];
    for (const term of entry.keyTerms.terms) {
      if (!normalizeWhitespace(term.term)) continue;
      if (yearsIn(term.term) !== null) {
        record({ check: "key-term", action: "term-dropped", path: `${path}.keyTerms`, value: term.term, replacement: "years" });
      } else if (containsTerm(requirement.sourceQuote ?? "", term.term)) own.push(term);
      else if (derived && containsTerm(derived.sourceQuote ?? "", term.term)) clauseTerms.push(term);
      else record({ check: "key-term", action: "term-dropped", path: `${path}.keyTerms`, value: term.term });
    }
    if (own.length) {
      // "dbt and data contracts" offers no alternative: every term counts. A parenthesised list is examples.
      const quote = requirement.sourceQuote ?? "";
      const offersChoice = ALTERNATIVE_WORD.test(quote) || /\([^)]*,[^)]*\)/.test(quote);
      const mode = entry.keyTerms.mode === "any" && own.length > 1 && !offersChoice ? "all" : entry.keyTerms.mode;
      if (mode !== entry.keyTerms.mode) {
        record({ check: "key-term", action: "mode-changed", path: `${path}.keyTerms.mode`, value: requirement.sourceQuote ?? "", replacement: mode });
      }
      requirement.keyTerms = { mode, terms: own };
    }
    if (derived) {
      // A softened clause names preferred options: "preferably Power BI or Looker".
      if (clauseTerms.length) derived.keyTerms = { mode: "any", terms: clauseTerms };
      requirements.push(derived);
      pending.push({ yearsEvidence: [] });
    }
  });

  return { requirements, pending, interventions };
}

const RANK: Record<RequirementStatus, number> = { missing: 0, partial: 1, met: 2, not_evident: -1 };

// Between two terms: list items ending in "or" ("C#, Java, JavaScript, or "), or a comma list without "and".
const OR_SEPARATOR = /^(?![\s\S]*(?:^|[^\p{L}])(?:and|y|e)(?:[^\p{L}]|$))[^;.()]*?(?:^|[\s,])(?:or|o|u|\/)\s*$/iu;
const COMMA_SEPARATOR = /^(?![\s\S]*(?:^|[^\p{L}])(?:and|y|e)(?:[^\p{L}]|$))\s*,[^;.()]*$/iu;

/**
 * Which terms the posting offers as alternatives to each other, from its own words: terms joined
 * by "or" ("BigQuery o Snowflake", "C, C++, or Python") or listed in one parenthesis
 * ("(Prometheus, Grafana, OpenTelemetry)") form one group; every other term is a group of its own.
 */
export function termGroups(quote: string, terms: string[]): number[][] {
  const lower = quote.toLowerCase();
  const located = terms.map((term, i) => {
    const at = lower.indexOf(term.trim().toLowerCase());
    return { i, at, end: at + term.trim().length };
  });
  const groups: number[][] = located.filter((one) => one.at < 0).map((one) => [one.i]);
  let run: typeof located = [];
  let joinedByOr = false;
  const flush = () => {
    if (run.length === 0) return;
    const first = run[0];
    const last = run[run.length - 1];
    const inParens = run.length > 1 && /\([^()]*$/.test(quote.slice(0, first.at)) && /^[^()]*\)/.test(quote.slice(last.end));
    if (joinedByOr || inParens) groups.push(run.map((one) => one.i));
    else for (const one of run) groups.push([one.i]);
    run = [];
    joinedByOr = false;
  };
  for (const one of located.filter((item) => item.at >= 0).sort((a, b) => a.at - b.at)) {
    const previous = run[run.length - 1];
    if (previous) {
      const between = quote.slice(previous.end, one.at);
      if (OR_SEPARATOR.test(between)) joinedByOr = true;
      else if (!COMMA_SEPARATOR.test(between)) flush();
    }
    run.push(one);
  }
  flush();
  return groups;
}

const shownTerm = (term: KeyTerms["terms"][number]) => Boolean(normalizeWhitespace(term.cvMatch));

/** The terms without the alternatives the candidate does not need: one shown term satisfies its group. */
export function neededTerms(keyTerms: KeyTerms, quote: string): KeyTerms {
  if (keyTerms.mode === "any") {
    const shown = keyTerms.terms.filter(shownTerm);
    return shown.length ? { ...keyTerms, terms: shown } : keyTerms;
  }
  const drop = new Set<number>();
  for (const group of termGroups(quote, keyTerms.terms.map((term) => term.term))) {
    if (group.length > 1 && group.some((i) => shownTerm(keyTerms.terms[i]))) {
      for (const i of group) if (!shownTerm(keyTerms.terms[i])) drop.add(i);
    }
  }
  return { ...keyTerms, terms: keyTerms.terms.filter((_, i) => !drop.has(i)) };
}

/** The highest status key-term coverage allows; null when it allows the model's own. "all" counts groups of alternatives. */
export function coverageCap(keyTerms: KeyTerms | undefined, quote = ""): RequirementStatus | null {
  if (!keyTerms || keyTerms.terms.length === 0) return null;
  if (keyTerms.mode === "any") return keyTerms.terms.some(shownTerm) ? null : "missing";
  const groups = termGroups(quote, keyTerms.terms.map((term) => term.term));
  const covered = groups.filter((group) => group.some((i) => shownTerm(keyTerms.terms[i]))).length;
  if (covered === groups.length) return null;
  return covered > 0 ? "partial" : "missing";
}

const joinTerms = (terms: string[], word: string) =>
  terms.length <= 1 ? (terms[0] ?? "") : `${terms.slice(0, -1).join(", ")} ${word} ${terms[terms.length - 1]}`;

/**
 * The terms a requirement names that the CV does not show, as one phrase: "Ruby on Rails",
 * "Redis, Elasticsearch or Sidekiq", "Kubernetes and AWS or GCP" (alternatives joined by "or", the rest by "and").
 */
export function absentTerms(keyTerms: KeyTerms | undefined, quote = "", language: AnalysisLanguage = "en"): string {
  if (!keyTerms) return "";
  const words = WORDING[language];
  const absent = keyTerms.terms.map((term, i) => ({ term: term.term, i })).filter(({ i }) => !shownTerm(keyTerms.terms[i]));
  if (keyTerms.mode === "any") return joinTerms(absent.map((one) => one.term), words.or);
  const missing = new Set(absent.map((one) => one.i));
  const phrases = termGroups(quote, keyTerms.terms.map((term) => term.term))
    .filter((group) => group.every((i) => missing.has(i)))
    .map((group) => joinTerms(group.map((i) => keyTerms.terms[i].term), words.or));
  return joinTerms(phrases, words.and);
}

function coverageNote(keyTerms: KeyTerms, to: RequirementStatus, quote: string, language: AnalysisLanguage): string {
  const words = WORDING[language];
  const shown = keyTerms.terms.filter(shownTerm).map((term) => term.term);
  const absent = absentTerms(keyTerms, quote, language);
  if (to === "partial") return words.shownButNot(joinTerms(shown, words.and), absent);
  return keyTerms.mode === "any" && keyTerms.terms.length > 1 ? words.noneOf(absent) : words.notShown(absent);
}

/** The alternative a CV cannot show, from the posting's own words; null when there is none. */
export function unshowableAlternativeIn(sourceQuote: string): string | null {
  const match = UNSHOWABLE_ALTERNATIVE.exec(sourceQuote);
  return match ? match[1].trim().replace(/[\s,]+$/, "") : null;
}

function alternativeNote(requirement: Requirement, alternative: string, language: AnalysisLanguage): string {
  const terms = absentTerms(requirement.keyTerms, requirement.sourceQuote, language);
  const absent = terms || (withoutClause(requirement.requirement, alternative) ?? requirement.requirement);
  const several = requirement.keyTerms?.mode === "all" && requirement.keyTerms.terms.filter((term) => !shownTerm(term)).length > 1;
  const accepts = alternative.replace(/^(?:or|o|u)\s+/i, "");
  return WORDING[language].alternative(absent, several, accepts);
}

const LANGUAGE_NAME =
  /(?<!\p{L})(?:english|spanish|german|french|portuguese|italian|dutch|polish|mandarin|chinese|japanese|korean|arabic|russian|hindi|ingl[eé]s|espa[nñ]ol|castellano|alem[aá]n|franc[eé]s|portugu[eé]s|italiano|neerland[eé]s|holand[eé]s|polaco|chino|japon[eé]s|coreano|[aá]rabe|ruso)(?!\p{L})/giu;
const CV_LANGUAGE: Record<AnalysisLanguage, RegExp> = { en: /^(?:english|ingl[eé]s)$/i, es: /^(?:spanish|espa[nñ]ol|castellano)$/i };

/** A requirement that names one language, the one the CV is written in: the CV itself shows it. */
export function asksForCvLanguage(requirement: Requirement, cvLanguage: AnalysisLanguage): boolean {
  const names = new Set(`${requirement.requirement} ${requirement.sourceQuote ?? ""}`.match(LANGUAGE_NAME)?.map((name) => name.toLowerCase()) ?? []);
  return names.size > 0 && [...names].every((name) => CV_LANGUAGE[cvLanguage].test(name));
}

/** Context for the status rules: what the model read, the day it read it, and the language it wrote in. */
export type StatusContext = { pending: PendingRequirement[]; cvText: string; now: Date; language?: AnalysisLanguage };

/** After guardAnalysis, so evidence it dropped counts as none. */
export function enforceRequirementStatuses(
  requirements: Requirement[],
  context?: StatusContext,
): { requirements: Requirement[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const language = context?.language ?? "en";
  const words = WORDING[language];
  const cvLanguage = context ? detectPostingLanguage(context.cvText) : null;

  const enforced = requirements.map((original, index) => {
    const requirement: Requirement = { ...original, ...(original.keyTerms ? { keyTerms: { ...original.keyTerms, terms: original.keyTerms.terms.map((term) => ({ ...term })) } } : {}) };
    const at = `jobFit.requirements[${index}]`;
    const path = `${at}.status`;
    const pending = context?.pending[index];
    // Analyses stored before the field existed read as assessable.
    let assessable = requirement.assessable !== false;
    const lower = (check: "key-term" | "years", to: RequirementStatus, note: string) => {
      interventions.push({ check, action: "status-capped", path, value: `${requirement.status}: ${requirement.requirement}`, replacement: to });
      requirement.status = to;
      requirement.note = note;
    };

    if (context && requirement.keyTerms) {
      for (const [i, term] of requirement.keyTerms.terms.entries()) {
        if (normalizeWhitespace(term.cvMatch) && !containsTerm(context.cvText, term.cvMatch)) {
          interventions.push({ check: "key-term", action: "match-dropped", path: `${at}.keyTerms.terms[${i}].cvMatch`, value: `${term.term}: ${term.cvMatch}` });
          term.cvMatch = "";
        }
      }
      requirement.keyTerms = neededTerms(requirement.keyTerms, requirement.sourceQuote ?? "");
      const cap = coverageCap(requirement.keyTerms, requirement.sourceQuote);
      if (cap && RANK[requirement.status] > RANK[cap]) {
        lower("key-term", cap, coverageNote(requirement.keyTerms, cap, requirement.sourceQuote ?? "", language));
        // Nothing the requirement names is in the CV, so the quote showed something else.
        if (cap === "missing") requirement.evidence = "";
      }
    }

    const min = assessable ? yearsIn(requirement.sourceQuote ?? "") : null;
    if (context && pending && min !== null) {
      const grounded = pending.yearsEvidence.filter((quote) => normalizeWhitespace(quote) && groundQuotes(context.cvText, [{ path: "", value: quote }]).length === 0);
      const found = candidateYears([...grounded, requirement.evidence].filter(Boolean), context.now);
      if (!found) {
        interventions.push({ check: "years", action: "recorded", path, value: requirement.requirement, replacement: "undetermined" });
      } else {
        requirement.years = { min, candidate: found.candidate, source: found.source };
        if (!requirement.evidence.trim() && grounded[0]) requirement.evidence = grounded[0];
        const byYears = yearsStatus(min, found.candidate);
        // Years decide the years; key terms still cap the rest.
        const cap = coverageCap(requirement.keyTerms, requirement.sourceQuote);
        const to = cap && RANK[cap] < RANK[byYears] ? cap : byYears;
        const note = yearsNote(min, found.candidate, language);
        if (requirement.status === "not_evident") {
          // Left alone: the coercion below decides.
        } else if (RANK[requirement.status] > RANK[to]) {
          lower("years", to, note);
        } else if (requirement.status === "partial" && RANK[to] > RANK.partial) {
          // Raised only from partial: a missing may be the model ruling the quoted roles irrelevant.
          interventions.push({ check: "years", action: "status-coerced", path, value: `${requirement.status}: ${requirement.requirement}`, replacement: to });
          requirement.status = to;
          requirement.note = note;
        } else if (requirement.status === to) {
          requirement.note = note;
        }
        // Lower than the numbers allow: the model's note gives its other reason, and the numbers would contradict it.
      }
    }

    // A verified CV match is evidence: quote its line rather than downgrade for a quote the guardrail dropped.
    if (context && (requirement.status === "met" || requirement.status === "partial") && !requirement.evidence.trim()) {
      const match = requirement.keyTerms?.terms.find(shownTerm);
      const lines = match ? cvLines(context.cvText, []) : [];
      const lineAt = match ? lines.findIndex((line) => !line.heading && containsTerm(line.text, match.cvMatch)) : -1;
      if (lineAt >= 0) {
        requirement.evidence = lineSpan(lines, lineAt);
        interventions.push({ check: "evidence-source", action: "evidence-replaced", path: `${at}.evidence`, value: "", replacement: requirement.evidence });
      }
    }

    if ((requirement.status === "met" || requirement.status === "partial") && !requirement.evidence.trim()) {
      const to = assessable ? "missing" : "not_evident";
      interventions.push({ check: "met-without-evidence", action: "status-downgraded", path, value: `${requirement.status}: ${requirement.requirement}`, replacement: to });
      requirement.status = to;
      requirement.note = words.downgrade;
    }

    // From the posting's words (M8-C measured a model field beside it: same hits, 13 false alarms in 108 analyses).
    const alternative = unshowableAlternativeIn(requirement.sourceQuote ?? "");
    if (alternative) {
      interventions.push({ check: "unshowable-alternative", action: "recorded", path: `${at}.sourceQuote`, value: requirement.sourceQuote ?? "" });
      assessable = false;
      requirement.assessable = false;
      if (requirement.status === "missing") {
        interventions.push({ check: "unshowable-alternative", action: "status-coerced", path, value: `missing: ${requirement.requirement}`, replacement: "not_evident" });
        requirement.status = "not_evident";
      }
      // The note says what is absent and what the posting accepts, whoever chose not_evident.
      if (requirement.status === "not_evident") {
        requirement.note = alternativeNote(requirement, alternative, language);
        requirement.evidence = "";
      }
    }

    if (requirement.status === "not_evident" && assessable) {
      interventions.push({ check: "not-evident", action: "status-coerced", path, value: `not_evident: ${requirement.requirement}`, replacement: "missing" });
      requirement.status = "missing";
    } else if (requirement.status === "missing" && !assessable) {
      interventions.push({ check: "not-evident", action: "status-coerced", path, value: `missing: ${requirement.requirement}`, replacement: "not_evident" });
      requirement.status = "not_evident";
    }

    // "Fluency in English" on a CV written in English: the CV itself is the evidence.
    if (cvLanguage && (requirement.status === "missing" || requirement.status === "not_evident") && asksForCvLanguage(requirement, cvLanguage)) {
      interventions.push({ check: "cv-language", action: "status-coerced", path, value: `${requirement.status}: ${requirement.requirement}`, replacement: "met" });
      requirement.status = "met";
      requirement.assessable = true;
      requirement.note = words.cvLanguage(words.languageName[cvLanguage]);
    }
    return requirement;
  });

  return { requirements: enforced, interventions };
}

const SECTION_HEADING =
  /^(?:(?:professional|work|relevant|technical|key|core|academic|personal|side)\s+)*(?:summary|profile|about(?:\s+me)?|objective|experience|employment(?:\s+history)?|work\s+history|career(?:\s+history)?|projects?|skills?(?:\s+(?:&|and)\s+\w+)?|competencies|tools|education|certifications?|courses|languages|resumen|perfil|sobre\s+m[ií]|objetivo|experiencia(?:\s+(?:laboral|profesional))?|trayectoria|proyectos|habilidades|competencias|conocimientos|herramientas|formaci[oó]n(?:\s+acad[eé]mica)?|educaci[oó]n|estudios|certificaciones|cursos|idiomas)\s*:?$/i;

export function sourceOfHeading(heading: string): EvidenceSource {
  const text = heading.toLowerCase();
  if (/summary|profile|about|objective|resumen|perfil|sobre m|objetivo/.test(text)) return "summary";
  if (/skill|competenc|tools|tecnolog|herramient|conocimiento|habilidad|stack/.test(text)) return "skills";
  if (/project|proyecto|portfolio/.test(text)) return "projects";
  if (/education|educaci|formaci|academic|certific|course|curso|estudio|degree/.test(text)) return "education";
  if (/experien|employment|work|career|trayectoria|professional|laboral/.test(text)) return "experience";
  return "other";
}

type CvLine = { text: string; section: EvidenceSource; heading: boolean };

/** The CV's lines, each with the section of the last heading above it (from sectionsDetected or a known heading). */
export function cvLines(cvText: string, headings: string[]): CvLine[] {
  const known = new Set(headings.map((heading) => loosen(heading)).filter(Boolean));
  let current: EvidenceSource = "other";
  return cvText.split(/\r?\n/).map((line) => {
    const text = normalizeWhitespace(line);
    if (text && (known.has(loosen(text)) || SECTION_HEADING.test(text))) {
      current = sourceOfHeading(text);
      return { text: line, section: current, heading: true };
    }
    return { text: line, section: current, heading: false };
  });
}

/** The CV section a quote sits in; "other" when it cannot be placed. */
export function evidenceSourceOf(cvText: string, quote: string, headings: string[]): EvidenceSource {
  const lines = cvLines(cvText, headings);
  const target = loosen(quote).slice(0, 40);
  if (!target) return "other";
  const head = target.slice(0, 15);
  for (const [i, line] of lines.entries()) {
    if (line.heading) continue;
    // The quote starts on this line and may wrap onto the next two.
    if (loosen(line.text).includes(head) && loosen(lines.slice(i, i + 3).map((one) => one.text).join(" ")).includes(target)) return line.section;
  }
  return "other";
}

const BULLET_START = /^\s*(?:[•·▪◦‣∙*–—-]|\d{1,2}[.)])\s/u;

/** A line and the lines it wraps onto (they start in lowercase): verbatim CV text, whitespace aside. */
function lineSpan(lines: CvLine[], at: number): string {
  let end = at;
  while (
    end + 1 < lines.length &&
    end - at < 2 &&
    !/[.!?]\s*$/.test(lines[end].text) &&
    /^\s*\p{Ll}/u.test(lines[end + 1].text) &&
    !lines[end + 1].heading &&
    !BULLET_START.test(lines[end + 1].text)
  ) {
    end += 1;
  }
  return normalizeWhitespace(lines.slice(at, end + 1).map((line) => line.text).join(" "));
}

/** The experience or project line showing the most matched terms, and how many it shows; null when none shows one. */
export function experienceLineFor(lines: CvLine[], keyTerms: KeyTerms | undefined): { text: string; hits: number; of: number } | null {
  const matches = (keyTerms?.terms ?? []).map((term) => term.cvMatch).filter((match) => normalizeWhitespace(match));
  if (matches.length === 0) return null;
  let best: { at: number; hits: number } | null = null;
  for (const [i, line] of lines.entries()) {
    if (line.heading || (line.section !== "experience" && line.section !== "projects")) continue;
    const hits = matches.filter((match) => containsTerm(line.text, match)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { at: i, hits };
  }
  return best ? { text: lineSpan(lines, best.at), hits: best.hits, of: matches.length } : null;
}

/**
 * Each requirement's evidence placed in its CV section. A skills-list quote gives way to an
 * experience or project line that shows the term in use (every term, for an "all" requirement);
 * `skillsOnly` marks a met or partial whose terms no such line shows.
 */
export function withEvidenceSources(
  requirements: Requirement[],
  cvText: string,
  headings: string[],
): { requirements: Requirement[]; interventions: Intervention[] } {
  const lines = cvLines(cvText, headings);
  const interventions: Intervention[] = [];
  const placed = requirements.map((requirement, index) => {
    if (!requirement.evidence.trim()) return requirement;
    const source = evidenceSourceOf(cvText, requirement.evidence, headings);
    if (source !== "skills" || (requirement.status !== "met" && requirement.status !== "partial")) {
      return { ...requirement, evidenceSource: source };
    }
    const line = experienceLineFor(lines, requirement.keyTerms);
    if (line && (requirement.keyTerms?.mode === "any" || line.hits === line.of)) {
      interventions.push({ check: "evidence-source", action: "evidence-replaced", path: `jobFit.requirements[${index}].evidence`, value: requirement.evidence, replacement: line.text });
      return { ...requirement, evidence: line.text, evidenceSource: evidenceSourceOf(cvText, line.text, headings) };
    }
    // Without key terms there is nothing to look for; the quote stays, unflagged.
    return { ...requirement, evidenceSource: source, ...(requirement.keyTerms ? { skillsOnly: !line } : {}) };
  });
  return { requirements: placed, interventions };
}

const SHORT_LABEL = 60;

function gapLabel(requirement: Requirement, language: AnalysisLanguage): string {
  if (requirement.years && requirement.years.candidate < requirement.years.min) return WORDING[language].yearsLabel(requirement.years.min);
  const terms = absentTerms(requirement.keyTerms, requirement.sourceQuote, language);
  if (terms) return terms;
  const text = requirement.requirement.replace(/[.;:,\s]+$/, "");
  if (text.length <= SHORT_LABEL) return text;
  return `${text.slice(0, SHORT_LABEL).replace(/\s+\S*$/, "")}…`;
}

/** The analysis' first sentence, from the statuses, so it cannot contradict them; in the language the model wrote in. */
export function requirementHeadline(requirements: Requirement[], language: AnalysisLanguage = "en"): string {
  const words = WORDING[language];
  const required = requirements.filter((requirement) => requirement.kind === "required" && requirement.status !== "not_evident");
  if (required.length === 0) return "";
  const absent = (requirement: Requirement) => absentTerms(requirement.keyTerms, requirement.sourceQuote, language);
  // A partial whose named terms are absent is a gap in those terms; one without terms is partly met.
  const gaps = required
    .filter((requirement) => requirement.status === "missing" || (requirement.status === "partial" && absent(requirement)))
    .map((requirement) => gapLabel(requirement, language));
  const partly = required
    .filter((requirement) => requirement.status === "partial" && !absent(requirement))
    .map((requirement) => gapLabel(requirement, language));
  if (gaps.length === 0 && partly.length === 0) return words.allMet;
  return [gaps.length ? words.coreGaps(gaps.join("; ")) : "", partly.length ? words.partlyMet(partly.join("; ")) : ""]
    .filter(Boolean)
    .join(" ");
}

/** Matched skills keep a CV quote and a name the CV has; the rest are dropped. */
export function guardMatchedSkills(
  feedback: ResumeAnalysisFeedback,
  cvText: string,
): { feedback: ResumeAnalysisFeedback; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const matchedSkills = feedback.skills.matchedSkills.filter((skill, i) => {
    const path = `skills.matchedSkills[${i}]`;
    if (!skill.evidence.trim()) {
      interventions.push({ check: "matched-skill", action: "skill-dropped", path, value: skill.name, replacement: "no evidence" });
      return false;
    }
    if (!containsTerm(skill.evidence, skill.name) && !containsTerm(cvText, skill.name)) {
      interventions.push({ check: "matched-skill", action: "skill-dropped", path, value: skill.name, replacement: "not in the CV" });
      return false;
    }
    return true;
  });
  return { feedback: { ...feedback, skills: { ...feedback.skills, matchedSkills } }, interventions };
}
