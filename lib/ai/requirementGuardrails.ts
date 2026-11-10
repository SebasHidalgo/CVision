import { groundQuotes, loosen, mentionsTerm, normalizeWhitespace, numbersIn } from "@/lib/ai/analysisChecks";
import { codeNote, type AnalysisLanguage } from "@/lib/ai/analysisWording";
import { and, or, say, type Phrase, type Sentence } from "@/lib/ai/sentences";
import { renderPhrase, renderSentence, renderSentences } from "@/lib/i18n/sentences";
import { placeholderFor, spanFor, type Intervention } from "@/lib/ai/analysisGuardrails";
import { languagesAsked, statesLevel } from "@/lib/ai/requirementLanguages";
import { exampleSpans, locateTerm, withQuoteAlternatives, withRelatedField } from "@/lib/ai/requirementAlternatives";
import { candidateYears, roundYears, totalExperienceIn, withoutDateRanges, yearsClauseIn, yearsIn, yearsStatus } from "@/lib/ai/requirementYears";
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
export const DOWNGRADE_NOTE = renderSentence(say.downgrade(), "en");

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
  /qualif|skills|what you (?:need|bring|have)|you (?:have|bring)|you(?:'ll| will) need|who you are|about you|looking for|we need|we expect|buscamos|necesitas|perfil/i;

/** The kind a verified heading states, or null when it states none or both ("Other & Additional Requirements"). */
export function headingKind(heading: string): "required" | "preferred" | null {
  const preferred = PREFERRED_HEADING.test(heading);
  const required = REQUIRED_WORD.test(heading);
  if (preferred && required) return null;
  if (preferred) return "preferred";
  if (required || QUALIFICATIONS_HEADING.test(heading)) return "required";
  return null;
}

/** A heading naming qualifications of either kind, or both ("Job Requirements: Other & Additional"). */
export const namesQualifications = (heading: string) =>
  PREFERRED_HEADING.test(heading) || REQUIRED_WORD.test(heading) || QUALIFICATIONS_HEADING.test(heading);

/** A posting's way of offering a choice or examples; without one, named terms are all required. */
const ALTERNATIVE_WORD = /(?:^|[^\p{L}])(?:or|o|u|either|such as|e\.g\.|for example|for instance|like|including|similar|equivalent|comparable|por ejemplo|como|similar|equivalente)(?:[^\p{L}]|$)|\//iu;

type Found = { text: string; normalized: boolean };

/** The quote as the posting has it: verbatim, or rewritten when only case or punctuation differ. */
export function inPosting(posting: string, quote: string): Found | null {
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

// Clauses of one posting sentence: "…would help but is not essential; most of our best leads came from retail…".
const CLAUSE_BREAK = /;\s+|(?<=[.!?])\s+(?=\p{Lu})/u;

/** The one clause of a quote that holds a softening word, when the quote runs into other clauses; null otherwise. */
export function softenedClauseOf(quote: string): string | null {
  const clauses = quote.split(CLAUSE_BREAK).map((clause) => clause.trim()).filter(Boolean);
  if (clauses.length < 2) return null;
  const softened = clauses.filter((clause) => SOFTENING.test(clause));
  return softened.length === 1 ? softened[0].replace(/[\s;,]+$/, "") : null;
}

/** "ideally in e-commerce." -> "Ideally in e-commerce". */
export function clauseAsRequirement(clause: string): string {
  const text = clause.replace(/^[\s,;:.(–—-]+/, "").replace(/[\s,;:.)]+$/, "");
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** The posting text as a requirement line: no list marker, no closing punctuation. */
export function asRequirementText(quote: string): string {
  return quote.replace(/^[\s\-–—•*·]+/, "").replace(/[\s.;:,]+$/, "");
}

// The shortest part of a quote a title may be, unless it is half the quote or more.
const MIN_TITLE_WORDS = 3;

/**
 * The requirement in the posting's own words (M8-H): the part of the quote the model's line covers, as the
 * posting writes it, or the whole quote when the model rewrote it ("; " as " and ", another discipline's name).
 */
export function postingWords(requirement: string, quote: string): string {
  const line = asRequirementText(normalizeWhitespace(requirement));
  const span = line ? spanFor(quote, line) : null;
  // A label ("TypeScript" of "TypeScript experience is a plus") is not the posting's line; a whole clause is ("Fluent English; …").
  const count = (text: string) => normalizeWhitespace(text).split(" ").length;
  const clause = (text: string) => quote.split(/[;:]\s+|(?<=[.!?])\s+/).some((part) => loosen(part) === loosen(text));
  const kept = span && (count(span) >= MIN_TITLE_WORDS || 2 * count(span) >= count(quote) || clause(span)) ? span : null;
  const text = asRequirementText(kept ?? quote);
  // As written, but the first letter as the model wrote the same word ("Another European language"); never "Dbt".
  return kept && line[0] !== text[0] && line[0] === text[0].toLocaleUpperCase() ? line[0] + text.slice(1) : text;
}

// Relations under which a CV word shows the term; "related" and "none" do not. Absent only in answers recorded before M8-H.
const SHOWS_TERM = new Set(["same", "synonym", "abbreviation", "translation"]);

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

  // Company, team, stack and offer never; the work only when it demands a capability.
  const describesOnly = (entry: ModelRequirement) =>
    entry.section === "description" || (entry.section === "responsibilities" && !entry.demandsCapability);
  // A model that labels every required entry a description would leave no required item: keep them instead.
  const keepDescriptions = !model.some((entry) => entry.kind === "required" && !describesOnly(entry) && inPosting(posting, entry.sourceQuote));

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

    if (describesOnly(entry)) {
      if (!keepDescriptions) {
        record({ check: "posting-section", action: "requirement-dropped", path: `${path}.section`, value: entry.requirement, replacement: entry.section });
        return;
      }
      record({ check: "posting-section", action: "recorded", path: `${path}.section`, value: entry.requirement, replacement: `${entry.section}, kept: nothing required survived` });
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
    // The posting text the row's title comes from: the quote, without a softened clause split off below.
    let titleSource = source.text;
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
        // A clause cut from the middle leaves no contiguous quote; the title still drops it.
        titleSource = trimmedSource?.text ?? trimmed ?? requirement.requirement;

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

    // A preferred item softened by its own words is that clause; terms from the clauses around it are context.
    let contextTerms: string[] = [];
    if (requirement.kind === "preferred" && stated !== "preferred") {
      const own = softenedClauseOf(source.text);
      const ownSource = own ? inPosting(posting, own) : null;
      const outside = ownSource ? entry.keyTerms.terms.filter((term) => normalizeWhitespace(term.term) && !containsTerm(ownSource.text, term.term)) : [];
      if (ownSource && outside.length > 0) {
        record({ check: "softened-clause", action: "text-replaced", path: `${path}.sourceQuote`, value: source.text, replacement: ownSource.text });
        requirement.sourceQuote = ownSource.text;
        requirement.requirement = asRequirementText(ownSource.text);
        titleSource = ownSource.text;
        contextTerms = outside.filter(shownTerm).map((term) => term.term);
      }
    }

    const text = postingWords(requirement.requirement, titleSource);
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
      // Subjects the posting joins with "and" or "including" are each needed, whatever examples sit beside them (M8-H).
      const quote = requirement.sourceQuote ?? "";
      const offersChoice = ALTERNATIVE_WORD.test(quote) || /\([^)]*,[^)]*\)/.test(quote);
      const joined = joinsSubjects(quote, own.map((term) => term.term));
      const mode = entry.keyTerms.mode === "any" && own.length > 1 && (!offersChoice || joined) ? "all" : entry.keyTerms.mode;
      if (mode !== entry.keyTerms.mode) {
        record({ check: "key-term", action: "mode-changed", path: `${path}.keyTerms.mode`, value: requirement.sourceQuote ?? "", replacement: mode });
      }
      requirement.keyTerms = { mode, terms: own };
    }
    // The status rested only on terms the posting names as context: nothing the requirement asks for is shown.
    if (contextTerms.length > 0 && !requirement.keyTerms?.terms.some(shownTerm) && (requirement.status === "met" || requirement.status === "partial")) {
      record({ check: "softened-clause", action: "status-capped", path: `${path}.status`, value: `${requirement.status}: ${requirement.requirement}`, replacement: "missing" });
      requirement.status = "missing";
      requirement.evidence = "";
      Object.assign(requirement, codeNote([say.contextOnly(and(contextTerms), contextTerms.length > 1)]));
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

// Between two terms: list items ending in "or" ("Go, Rust, Kotlin, or ", "Elixir (or "), or a comma list without "and".
const OR_SEPARATOR = /^(?![\s\S]*(?:^|[^\p{L}])(?:and|y|e)(?:[^\p{L}]|$))[^;.()]*?(?:^|[\s,(])(?:or|o|u|\/)(?:\s+(?:a|an|the|un|una))?\s*$/iu;
const COMMA_SEPARATOR = /^(?![\s\S]*(?:^|[^\p{L}])(?:and|y|e)(?:[^\p{L}]|$))\s*,[^;.()]*$/iu;
// After a comma list: ", or a similar language" makes the list a choice.
const TRAILING_OR = /^[\s,]*(?:or|o|u|and\/or)\s/iu;

/**
 * Which terms the posting offers as alternatives to each other, from its own words: terms joined
 * by "or" ("BigQuery o Snowflake", "C, C++, or Python") or listed in one parenthesis
 * ("(Prometheus, Grafana, OpenTelemetry)") form one group; every other term is a group of its own.
 */
export function termGroups(quote: string, terms: string[]): number[][] {
  const located = terms.map((term, i) => {
    const at = locateTerm(quote, term);
    return { i, at, end: at + normalizeWhitespace(term).length };
  });
  const groups: number[][] = located.filter((one) => one.at < 0).map((one) => [one.i]);
  let run: typeof located = [];
  let joinedByOr = false;
  const flush = () => {
    if (run.length === 0) return;
    const first = run[0];
    const last = run[run.length - 1];
    const inParens = run.length > 1 && /\([^()]*$/.test(quote.slice(0, first.at)) && /^[^()]*\)/.test(quote.slice(last.end));
    const endsInOr = run.length > 1 && TRAILING_OR.test(quote.slice(last.end));
    if (joinedByOr || inParens || endsInOr) groups.push(run.map((one) => one.i));
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

/** One group of the cap; `examplesOnly` when it holds examples whose category is not among the terms. */
export type TermGroup = { members: number[]; examplesOnly: boolean };

/**
 * termGroups with examples apart (M8-H): an example joins the group of the category it illustrates
 * ("message queues (e.g., Kafka, SQS)"); examples whose category is not a term form a group of their own.
 * Groups come in posting order.
 */
export function coverageGroups(quote: string, terms: string[]): { groups: TermGroup[]; example: boolean[] } {
  const spans = exampleSpans(quote);
  const located = terms.map((term) => {
    const at = locateTerm(quote, term);
    return { at, end: at + normalizeWhitespace(term).length };
  });
  const spanOf = located.map(({ at, end }) => (at < 0 ? -1 : spans.findIndex((span) => at >= span.from && end <= span.end)));
  const groups: TermGroup[] = [];
  for (const group of termGroups(quote, terms)) {
    const own = group.filter((i) => spanOf[i] < 0);
    if (own.length) groups.push({ members: own, examplesOnly: false });
  }
  spans.forEach((span, s) => {
    const members = terms.map((_, i) => i).filter((i) => spanOf[i] === s);
    if (members.length === 0) return;
    // The category ends right where its examples start.
    const category = located.findIndex(({ at, end }, i) => spanOf[i] < 0 && at >= 0 && end <= span.start && /^[\s,:]*$/.test(quote.slice(end, span.start)));
    const home = category >= 0 ? groups.find((group) => group.members.includes(category)) : undefined;
    if (home) home.members.push(...members);
    else groups.push({ members, examplesOnly: true });
  });
  const first = (group: TermGroup) => Math.min(...group.members.map((i) => (located[i].at < 0 ? Infinity : located[i].at)));
  return { groups: groups.sort((a, b) => first(a) - first(b)), example: spanOf.map((s) => s >= 0) };
}

// Words that join subjects a requirement needs together, and words that offer a choice between them.
const AND_WORD = /(?:^|[^\p{L}])(?:and|y|including|incluyendo|as well as|plus|along with|además de)(?:[^\p{L}]|$)|[&;]/iu;
const OR_WORD = /(?:^|[^\p{L}])(?:or|o|u|either)(?:[^\p{L}]|$)|\//iu;

/** The quote joins two or more of these subjects with "and"/"including", never "or": each is needed. */
export function joinsSubjects(quote: string, terms: string[]): boolean {
  // "…on a formal rotation, or have run Prometheus and Grafana": the "and" sits inside one alternative.
  const outsideExamples = exampleSpans(quote).reduceRight((text, span) => text.slice(0, span.start) + text.slice(span.end), quote);
  if (OR_WORD.test(outsideExamples)) return false;
  const { groups } = coverageGroups(quote, terms);
  const spans: { at: number; end: number }[] = [];
  for (const group of groups.filter((one) => !one.examplesOnly)) {
    const at = group.members.map((i) => locateTerm(quote, terms[i]));
    if (at.some((one) => one < 0)) return false;
    spans.push({ at: Math.min(...at), end: Math.max(...group.members.map((i, k) => at[k] + normalizeWhitespace(terms[i]).length)) });
  }
  if (spans.length < 2) return false;
  return spans.slice(1).every((span, k) => {
    const between = quote.slice(spans[k].end, span.at);
    return AND_WORD.test(between) && !OR_WORD.test(between);
  });
}

/**
 * The highest status key-term coverage allows; null when it allows the model's own. "all" counts groups of
 * alternatives; examples with no category among the terms illustrate the requirement and never cap it by themselves.
 */
export function coverageCap(keyTerms: KeyTerms | undefined, quote = ""): RequirementStatus | null {
  if (!keyTerms || keyTerms.terms.length === 0) return null;
  const { groups } = coverageGroups(quote, keyTerms.terms.map((term) => term.term));
  const shown = (group: TermGroup) => group.members.some((i) => shownTerm(keyTerms.terms[i]));
  // A shown example shows the category it illustrates; examples not shown count against nothing.
  const counted = groups.filter((group) => !group.examplesOnly || shown(group));
  // Something related but not the same is adjacent: "partial" by its own definition, never "missing" (M8-H).
  const adjacent = groups.some((group) => !shown(group) && group.members.some((i) => keyTerms.terms[i].relation === "related"));
  if (keyTerms.mode === "any") return groups.some(shown) || counted.length === 0 ? null : adjacent ? "partial" : "missing";
  const covered = counted.filter(shown).length;
  if (covered === counted.length) return null;
  return covered > 0 || adjacent ? "partial" : "missing";
}

/**
 * The terms a requirement names that the CV does not show, as one phrase: "Ruby on Rails",
 * "Redis, Elasticsearch or Sidekiq", "Kubernetes and AWS or GCP" (alternatives joined by "or", the rest by "and").
 */
export function absentTerms(keyTerms: KeyTerms | undefined, quote = "", language: AnalysisLanguage = "en"): string {
  return renderPhrase(absentTermsPhrase(keyTerms, quote), language);
}

/** absentTerms as data: the terms verbatim, the conjunctions left to the language that renders it. */
export function absentTermsPhrase(keyTerms: KeyTerms | undefined, quote = ""): Phrase {
  if (!keyTerms) return "";
  const { groups, example } = coverageGroups(quote, keyTerms.terms.map((term) => term.term));
  const shown = (group: TermGroup) => group.members.some((i) => shownTerm(keyTerms.terms[i]));
  // An example is never named as missing: the category it illustrates is.
  const named = (group: TermGroup) => group.members.filter((i) => !example[i]).map((i) => keyTerms.terms[i].term);
  const counted = groups.filter((group) => !group.examplesOnly);
  // One shown alternative answers an "any" requirement: the others are not gaps.
  if (keyTerms.mode === "any") return groups.some(shown) ? "" : or(counted.flatMap(named));
  return and(counted.filter((group) => !shown(group)).map((group) => or(named(group))));
}

/** One term as the page lists it; `joiner` is the word before it ("or" between alternatives). */
export type TermChip = { term: string; cvMatch: string; shown: boolean; joiner: "or" | "and" | null };

/** Every term with ✓ or ✗ (M8-H): alternatives joined by "or", and the examples apart, where they cannot read as the requirement. */
export function termDisplay(keyTerms: KeyTerms, quote = ""): { terms: TermChip[]; examples: TermChip[] } {
  const { groups, example } = coverageGroups(quote, keyTerms.terms.map((term) => term.term));
  const chip = (i: number, joiner: TermChip["joiner"]): TermChip => ({
    term: keyTerms.terms[i].term,
    cvMatch: normalizeWhitespace(keyTerms.terms[i].cvMatch),
    shown: shownTerm(keyTerms.terms[i]),
    joiner,
  });
  const terms: TermChip[] = [];
  const examples: TermChip[] = [];
  for (const group of groups) {
    group.members
      .filter((i) => !example[i])
      .forEach((i, k) => terms.push(chip(i, terms.length === 0 ? null : k > 0 || keyTerms.mode === "any" ? "or" : "and")));
    for (const i of group.members.filter((one) => example[one])) examples.push(chip(i, examples.length === 0 ? null : "and"));
  }
  return { terms, examples };
}

function coverageNote(keyTerms: KeyTerms, to: RequirementStatus, quote: string): Sentence {
  const shown = keyTerms.terms.filter(shownTerm).map((term) => term.term);
  const absent = absentTermsPhrase(keyTerms, quote);
  if (to === "partial" && shown.length) return say.shownButNot(and(shown), absent);
  return keyTerms.mode === "any" && keyTerms.terms.length > 1 ? say.noneOf(absent) : say.notShown(absent);
}

/** The alternative a CV cannot show, from the posting's own words; null when there is none. */
export function unshowableAlternativeIn(sourceQuote: string): string | null {
  const match = UNSHOWABLE_ALTERNATIVE.exec(sourceQuote);
  return match ? match[1].trim().replace(/[\s,]+$/, "") : null;
}

export function alternativeNote(requirement: Requirement, alternative: string, language: AnalysisLanguage): string {
  return renderSentence(alternativeSentence(requirement, alternative), language);
}

/** What is absent and what the posting accepts instead, as data. */
export function alternativeSentence(requirement: Requirement, alternative: string): Sentence {
  const terms = absentTermsPhrase(requirement.keyTerms, requirement.sourceQuote);
  const absent = renderPhrase(terms, "en") ? terms : (withoutClause(requirement.requirement, alternative) ?? requirement.requirement);
  const several = requirement.keyTerms?.mode === "all" && requirement.keyTerms.terms.filter((term) => !shownTerm(term)).length > 1;
  const accepts = alternative.replace(/^(?:or|o|u)\s+/i, "");
  return say.alternative(absent, several, accepts);
}

/** Context for the status rules: what the model read, the day it read it, and the language it writes in. */
export type StatusContext = {
  pending: PendingRequirement[];
  cvText: string;
  now: Date;
  language?: AnalysisLanguage;
  /** The CV's own statement of its total years ("2+ years of experience"), from `statedTotalYears`. */
  statedYears?: number | null;
  /** The CV and the posting are in different languages: a term the code cannot find verbatim may still be there. */
  crossLanguage?: boolean;
};

/** After guardAnalysis, so evidence it dropped counts as none. */
export function enforceRequirementStatuses(
  requirements: Requirement[],
  context?: StatusContext,
): { requirements: Requirement[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const language = context?.language ?? "en";
  // Code-made notes are data; the pipeline also renders them, for its checks and its tests.
  const writeNote = (requirement: Requirement, sentences: Sentence[]) => Object.assign(requirement, codeNote(sentences, language));

  const enforced = requirements.map((original, index) => {
    const requirement: Requirement = { ...original, ...(original.keyTerms ? { keyTerms: { ...original.keyTerms, terms: original.keyTerms.terms.map((term) => ({ ...term })) } } : {}) };
    const at = `jobFit.requirements[${index}]`;
    const path = `${at}.status`;
    const pending = context?.pending[index];
    // Analyses stored before the field existed read as assessable.
    let assessable = requirement.assessable !== false;
    const lower = (check: "key-term" | "years", to: RequirementStatus, note: Sentence[]) => {
      interventions.push({ check, action: "status-capped", path, value: `${requirement.status}: ${requirement.requirement}`, replacement: to });
      requirement.status = to;
      writeNote(requirement, note);
    };

    // Alternatives of the quote the code could not look for: while one is left, key terms cap nothing.
    let unexamined: string[] = [];
    const keyTermCap = () => (unexamined.length ? null : coverageCap(requirement.keyTerms, requirement.sourceQuote));
    if (context && requirement.keyTerms) {
      for (const [i, term] of requirement.keyTerms.terms.entries()) {
        if (normalizeWhitespace(term.cvMatch) && !containsTerm(context.cvText, term.cvMatch)) {
          interventions.push({ check: "key-term", action: "match-dropped", path: `${at}.keyTerms.terms[${i}].cvMatch`, value: `${term.term}: ${term.cvMatch}` });
          term.cvMatch = "";
        }
      }
      const quote = requirement.sourceQuote ?? "";
      const related = withRelatedField(requirement.keyTerms, quote, `${at}.keyTerms`);
      interventions.push(...related.interventions);
      // A CV word that is only near the term does not show it (M8-H); one that contains the term itself does, however labelled.
      const nearby: string[] = [];
      for (const [i, term] of related.keyTerms.terms.entries()) {
        if (!normalizeWhitespace(term.cvMatch) || term.relation === undefined || SHOWS_TERM.has(term.relation) || containsTerm(term.cvMatch, term.term)) continue;
        interventions.push({ check: "key-term", action: "match-dropped", path: `${at}.keyTerms.terms[${i}].cvMatch`, value: `${term.term}: ${term.cvMatch}`, replacement: term.relation });
        if (term.relation === "related") nearby.push(normalizeWhitespace(term.cvMatch));
        term.cvMatch = "";
      }
      const offered = withQuoteAlternatives(related.keyTerms, quote, context.cvText, context.crossLanguage ?? false, `${at}.keyTerms`);
      interventions.push(...offered.interventions);
      unexamined = offered.unexamined;
      // Every term stays, alternatives and examples included: the page shows each with ✓ or ✗.
      requirement.keyTerms = offered.keyTerms;
      const cap = coverageCap(requirement.keyTerms, requirement.sourceQuote);
      if (cap && RANK[requirement.status] > RANK[cap]) {
        if (unexamined.length) {
          interventions.push({ check: "key-term", action: "cap-skipped", path, value: `${requirement.status}: ${requirement.requirement}`, replacement: unexamined.join(", ") });
        } else {
          // The related experience is named, not counted.
          lower("key-term", cap, [coverageNote(requirement.keyTerms, cap, quote), ...(nearby.length ? [say.relatedOnly(nearby)] : [])]);
          // Nothing the requirement names is in the CV, so the quote showed something else.
          if (cap === "missing") requirement.evidence = "";
        }
      }
    }

    const min = assessable ? yearsIn(requirement.sourceQuote ?? "") : null;
    if (context && pending && min !== null) {
      const grounded = pending.yearsEvidence.filter((quote) => normalizeWhitespace(quote) && groundQuotes(context.cvText, [{ path: "", value: quote }]).length === 0);
      const quoted = candidateYears([...grounded, requirement.evidence].filter(Boolean), context.now);
      const stated = context.statedYears ?? null;
      // A role's years are the CV's own total; a skill's are its quoted roles, and the total only bounds them from above.
      const skill = isSkillYears(requirement);
      const totalOnly = skill && !quoted && stated !== null && yearsStatus(min, stated) !== "met";
      const found: { candidate: number; source: "statement" | "dates" } | null = skill
        ? quoted
          ? { candidate: stated !== null ? Math.min(quoted.candidate, stated) : quoted.candidate, source: quoted.source }
          : totalOnly
            ? { candidate: stated, source: "statement" }
            : null
        : stated !== null
          ? { candidate: stated, source: "statement" }
          : quoted;
      if (!found) {
        interventions.push({ check: "years", action: "recorded", path, value: requirement.requirement, replacement: "undetermined" });
      } else {
        requirement.years = { min, candidate: found.candidate, source: found.source };
        if (!requirement.evidence.trim() && grounded[0]) requirement.evidence = grounded[0];
        const byYears = yearsStatus(min, found.candidate);
        // Years decide the years; key terms still cap the rest.
        const cap = keyTermCap();
        const to = cap && RANK[cap] < RANK[byYears] ? cap : byYears;
        const note = [totalOnly ? say.yearsTotal(min, roundYears(found.candidate)) : say.years(min, roundYears(found.candidate))];
        if (requirement.status === "not_evident") {
          // Left alone: the coercion below decides.
        } else if (RANK[requirement.status] > RANK[to]) {
          lower("years", to, note);
        } else if (
          requirement.status === "partial" &&
          RANK[to] > RANK.partial &&
          !totalOnly &&
          // A total bounds any part of it from above: raising also needs the model's own quoted years.
          (stated === null || (quoted !== null && RANK[yearsStatus(min, quoted.candidate)] >= RANK[to]))
        ) {
          // Raised only from partial: a missing may be the model ruling the quoted roles irrelevant.
          interventions.push({ check: "years", action: "status-coerced", path, value: `${requirement.status}: ${requirement.requirement}`, replacement: to });
          requirement.status = to;
          writeNote(requirement, note);
        } else if (requirement.status === byYears && to === byYears && !(cap && RANK[cap] <= RANK[byYears])) {
          // Only when the years decided: under a key-term cap the note is about the missing term.
          writeNote(requirement, note);
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
      writeNote(requirement, [say.downgrade()]);
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
        writeNote(requirement, [alternativeSentence(requirement, alternative)]);
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

    // A language level only counts when the CV states it; the one not_evident a CV could show (owner decision, M8-D).
    const unstated = context ? languagesAsked(requirement).filter((name) => !statesLevel(context.cvText, name)) : [];
    if (unstated.length) {
      if (requirement.status !== "not_evident") {
        interventions.push({ check: "language-level", action: "status-coerced", path, value: `${requirement.status}: ${requirement.requirement}`, replacement: "not_evident" });
      }
      requirement.status = "not_evident";
      requirement.evidence = "";
      writeNote(requirement, [say.languageLevel(unstated)]);
    }

    // "Not shown in your CV" beside a CV quote contradicts itself.
    if (requirement.status === "not_evident" && requirement.evidence.trim()) {
      interventions.push({ check: "not-evident", action: "evidence-cleared", path: `${at}.evidence`, value: requirement.evidence });
      requirement.evidence = "";
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

// Words too common in requirements to tie one to an experience line.
const GENERIC_WORDS = new Set(["experience", "experiences", "strong", "understanding", "knowledge", "ability", "skills", "working", "software", "development", "developer", "engineering", "engineer", "professional", "familiarity", "excellent", "proven", "including", "related", "practical", "equivalent"]);

/** Whether an experience or project line has one of the requirement's own longer words ("architecture", "regulated"). */
function experienceSharesWordWith(lines: CvLine[], requirement: string): boolean {
  const words = [...contentWords(requirement)].filter((word) => word.length >= 6 && !GENERIC_WORDS.has(word));
  return lines.some((line) => !line.heading && (line.section === "experience" || line.section === "projects") && words.some((word) => contentWords(line.text).has(word)));
}

/**
 * Each requirement's evidence placed in its CV section. A skills-list or summary quote gives way to an
 * experience or project line that shows the term in use (every term, for an "all" requirement);
 * `skillsOnly` marks a met or partial whose terms no such line shows, and `summaryOnly` one that rests
 * on the summary alone.
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
    if ((source !== "skills" && source !== "summary") || (requirement.status !== "met" && requirement.status !== "partial")) {
      return { ...requirement, evidenceSource: source };
    }
    const line = experienceLineFor(lines, requirement.keyTerms);
    if (line && (requirement.keyTerms?.mode === "any" || line.hits === line.of)) {
      interventions.push({ check: "evidence-source", action: "evidence-replaced", path: `jobFit.requirements[${index}].evidence`, value: requirement.evidence, replacement: line.text });
      return { ...requirement, evidence: line.text, evidenceSource: evidenceSourceOf(cvText, line.text, headings) };
    }
    if (source === "summary") {
      // Years are the years rule's: a summary's total and the dated roles agree.
      if (yearsIn(requirement.sourceQuote ?? "") !== null) return { ...requirement, evidenceSource: source };
      const shown = requirement.keyTerms?.terms.length ? Boolean(line) : experienceSharesWordWith(lines, requirement.requirement);
      return { ...requirement, evidenceSource: source, summaryOnly: !shown };
    }
    // Without key terms there is nothing to look for; the quote stays, unflagged.
    return { ...requirement, evidenceSource: source, ...(requirement.keyTerms ? { skillsOnly: !line } : {}) };
  });
  return { requirements: placed, interventions };
}

const SHORT_LABEL = 60;

// A key term naming a role ("SRE roles", "analista de datos", "product management") makes the years the role's.
const ROLE_TERM = /(?<![\p{L}])(?:roles?|positions?|engineer\w*|develop\w*|analyst\w*|analista\w*|manag\w*|lead\w*|experience|experiencia|ingenier\w*|desarrollador\w*|consultant\w*|consultor\w*|programmer\w*|programador\w*)(?![\p{L}])/iu;

/** "3+ years writing production Python": years of one skill or domain, which a CV's total only bounds from above. */
export function isSkillYears(requirement: Pick<Requirement, "keyTerms" | "sourceQuote">): boolean {
  const quote = requirement.sourceQuote ?? "";
  const clause = yearsClauseIn(quote).toLowerCase();
  if (!clause) return false;
  const terms = requirement.keyTerms?.terms ?? [];
  // An example ("languages including C#, Java") says nothing about whose years these are (M8-H).
  const { example } = coverageGroups(quote, terms.map((term) => term.term));
  return terms.some((term, i) => !example[i] && term.term.trim() && locateTerm(clause, term.term) >= 0 && !ROLE_TERM.test(term.term));
}

export function gapLabel(requirement: Requirement, language: AnalysisLanguage): string {
  return renderPhrase(gapLabelPhrase(requirement), language);
}

/** A gap's short name as data: its years, its absent terms or examples, or the posting's words cut short. */
export function gapLabelPhrase(requirement: Requirement): Phrase {
  if (requirement.years && requirement.years.candidate < requirement.years.min && !isSkillYears(requirement)) return say.yearsLabel(requirement.years.min);
  const terms = absentTermsPhrase(requirement.keyTerms, requirement.sourceQuote);
  if (renderPhrase(terms, "en")) return terms;
  // Named only by examples: the examples the CV lacks are the clearest label.
  const examples = absentExamplesPhrase(requirement.keyTerms, requirement.sourceQuote);
  if (renderPhrase(examples, "en")) return examples;
  const text = requirement.requirement.replace(/[.;:,\s]+$/, "");
  if (text.length <= SHORT_LABEL) return text;
  return `${text.slice(0, SHORT_LABEL).replace(/\s+\S*$/, "").replace(/[\s,;:.]+$/, "")}…`;
}

/** The unshown examples of a requirement that names nothing but examples ("tools such as Redis or Sidekiq"); "" otherwise. */
export function absentExamples(keyTerms: KeyTerms | undefined, quote = "", language: AnalysisLanguage = "en"): string {
  return renderPhrase(absentExamplesPhrase(keyTerms, quote), language);
}

function absentExamplesPhrase(keyTerms: KeyTerms | undefined, quote = ""): Phrase {
  if (!keyTerms || keyTerms.terms.length === 0) return "";
  const { groups, example } = coverageGroups(quote, keyTerms.terms.map((term) => term.term));
  if (!groups.every((group) => group.examplesOnly)) return "";
  return or(keyTerms.terms.filter((term, i) => example[i] && !shownTerm(term)).map((term) => term.term));
}

/** The analysis' first sentence, from the statuses, so it cannot contradict them; in the language the model wrote in. */
export function requirementHeadline(requirements: Requirement[], language: AnalysisLanguage = "en"): string {
  return renderSentences(requirementHeadlineSentences(requirements), language);
}

/** The headline as data. */
export function requirementHeadlineSentences(requirements: Requirement[]): Sentence[] {
  const required = requirements.filter((requirement) => requirement.kind === "required" && requirement.status !== "not_evident");
  const notShown = requirements.filter((requirement) => requirement.kind === "required" && requirement.status === "not_evident").length;
  if (required.length === 0 && notShown === 0) return [];
  const absent = (requirement: Requirement) => absentTerms(requirement.keyTerms, requirement.sourceQuote);
  // A partial whose named terms are absent is a gap in those terms; one without terms is partly met.
  const gaps = required
    .filter((requirement) => requirement.status === "missing" || (requirement.status === "partial" && absent(requirement)))
    .map(gapLabelPhrase);
  const partly = required.filter((requirement) => requirement.status === "partial" && !absent(requirement)).map(gapLabelPhrase);
  // "Every required qualification" would contradict the "Not shown in your CV" group below it.
  if (gaps.length === 0 && partly.length === 0) return [notShown ? say.noGapsNotShown(notShown) : say.allMet()];
  return [...(gaps.length ? [say.coreGaps(gaps)] : []), ...(partly.length ? [say.partlyMet(partly)] : [])];
}

/**
 * Matched skills keep a name the CV has and a CV quote that names it (or its verified CV word). A quote
 * that does not, or that the guardrail dropped, becomes the CV line that does, experience first; a skill
 * no line names is dropped.
 */
export function guardMatchedSkills(
  feedback: ResumeAnalysisFeedback,
  cvText: string,
): { feedback: ResumeAnalysisFeedback; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  // The requirements' verified CV words: "PostgreSQL" is shown by "Postgres".
  const verified = feedback.jobFit.requirements.flatMap((requirement) => requirement.keyTerms?.terms ?? []).filter(shownTerm);
  const lines = cvLines(cvText, feedback.atsCompatibility.sectionsDetected);
  const matchedSkills = feedback.skills.matchedSkills.flatMap((skill, i) => {
    const path = `skills.matchedSkills[${i}]`;
    const synonym = containsTerm(cvText, skill.name)
      ? undefined
      : verified.find((term) => (containsTerm(term.term, skill.name) || containsTerm(skill.name, term.term)) && containsTerm(cvText, term.cvMatch));
    const words = synonym ? [synonym.cvMatch] : containsTerm(cvText, skill.name) ? [skill.name] : [];
    if (words.length === 0) {
      interventions.push({ check: "matched-skill", action: "skill-dropped", path, value: skill.name, replacement: "not in the CV" });
      return [];
    }
    if (synonym) interventions.push({ check: "matched-skill", action: "recorded", path, value: skill.name, replacement: `synonym: ${synonym.cvMatch}` });
    if (words.some((word) => containsTerm(skill.evidence, word))) return [skill];
    const names = (line: CvLine) => !line.heading && words.some((word) => containsTerm(line.text, word));
    const inUse = lines.findIndex((line) => (line.section === "experience" || line.section === "projects") && names(line));
    const at = inUse >= 0 ? inUse : lines.findIndex(names);
    if (at < 0) {
      interventions.push({ check: "matched-skill", action: "skill-dropped", path, value: skill.name, replacement: "no line names it" });
      return [];
    }
    const evidence = lineSpan(lines, at);
    interventions.push({ check: "matched-skill", action: "evidence-replaced", path: `${path}.evidence`, value: skill.evidence, replacement: evidence });
    return [{ ...skill, evidence }];
  });
  return { feedback: { ...feedback, skills: { ...feedback.skills, matchedSkills } }, interventions };
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Every string in the value without control characters (the model once wrote U+0003 for "´"). */
export function withoutControlCharacters<T>(value: T): T {
  if (typeof value === "string") return value.replace(CONTROL_CHARACTERS, "") as T;
  if (Array.isArray(value)) return value.map((item) => withoutControlCharacters(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutControlCharacters(item)])) as T;
  }
  return value;
}

/** The CV's own statement of its total years: the first one in its summary or above its first heading, outside parentheses. */
export function statedTotalYears(cvText: string, headings: string[]): number | null {
  let pastFirstHeading = false;
  for (const line of cvLines(cvText, headings)) {
    if (line.heading) {
      pastFirstHeading = true;
      continue;
    }
    if (pastFirstHeading && line.section !== "summary") continue;
    // "Python (6 years)" is one skill's years, and "eight years on JVM services" is not said to be the total.
    const years = totalExperienceIn(line.text.replace(/\([^)]*\)/g, " "));
    if (years !== null) return years;
  }
  return null;
}

// Letters and digits only, accents and typography gone: "Asociaci´on" and "Asociación" read the same.
const lettersOf = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const ROLE_SEPARATOR = /\s*(?:,|\||·|\s[-–—]\s|\sat\s|\sen\s|\s@\s)\s*/;

/** One experience or project entry: its title and company lines, then its bullets with their wrapped lines. */
export type CvEntry = { header: string[]; bullets: string[] };

// Title and company lines are short and unpunctuated; a sentence is a bullet even without a marker.
const BULLET_SENTENCE_CHARS = 80;
function isBulletLine(lines: CvLine[], at: number): boolean {
  const text = normalizeWhitespace(lines[at].text);
  const next = normalizeWhitespace(lines[at + 1]?.text ?? "");
  return BULLET_START.test(lines[at].text) || /[.;]$/.test(text) || /^\p{Ll}/u.test(next) || text.length >= BULLET_SENTENCE_CHARS;
}

/** The entries of the experience and projects sections, in CV order. */
export function cvEntries(cvText: string, headings: string[]): CvEntry[] {
  const lines = cvLines(cvText, headings);
  const entries: CvEntry[] = [];
  let current: CvEntry | null = null;
  for (const [i, line] of lines.entries()) {
    const text = normalizeWhitespace(line.text);
    if (line.heading) current = null;
    if (line.heading || !text || (line.section !== "experience" && line.section !== "projects")) continue;
    // A wrapped bullet line is already in its bullet.
    if (/^\p{Ll}/u.test(text) && current?.bullets.length) continue;
    if (isBulletLine(lines, i)) {
      if (!current) entries.push((current = { header: [], bullets: [] }));
      current.bullets.push(normalizeWhitespace(lineSpan(lines, i)));
      continue;
    }
    if (!current || current.bullets.length > 0 || current.header.length >= 2) entries.push((current = { header: [], bullets: [] }));
    current.header.push(text);
  }
  return entries.filter((entry) => entry.header.length > 0 || entry.bullets.length > 0);
}

const entryLabel = (entry: CvEntry) =>
  entry.header
    .map((line) => normalizeWhitespace(withoutDateRanges(line)).replace(/[\s|,·–—-]+$/u, ""))
    .filter(Boolean)
    .join(", ");

const contentWords = (text: string) => new Set(text.split(/[^\p{L}\p{N}]+/u).map(lettersOf).filter((word) => word.length >= 3));
const sharedWords = (a: Set<string>, b: string) => [...contentWords(b)].filter((word) => a.has(word)).length;

// A suggested bullet sharing this many words with a CV bullet is a rewrite of it.
const SOURCE_BULLET_WORDS = 3;

/**
 * A suggested bullet's role names a role and company the CV has; otherwise it
 * becomes the CV entry's title and company lines. A figure in an example must
 * be in the CV bullet it rewrites, or, without one, in its role's text;
 * otherwise it becomes the placeholder ("reducing downtime by 40%" moved onto
 * another bullet of the same role).
 */
export function guardBulletRoles(
  feedback: ResumeAnalysisFeedback,
  cvText: string,
): { feedback: ResumeAnalysisFeedback; interventions: Intervention[] } {
  const cvLetters = lettersOf(cvText);
  const entries = cvEntries(cvText, feedback.atsCompatibility.sectionsDetected);
  const interventions: Intervention[] = [];
  const nearestEntry = (label: string) => {
    const wanted = contentWords(label);
    let nearest: { entry: CvEntry; shared: number } | null = null;
    for (const entry of entries) {
      const shared = sharedWords(wanted, entry.header.join(" "));
      if (shared > 0 && (!nearest || shared > nearest.shared)) nearest = { entry, shared };
    }
    return nearest?.entry ?? null;
  };

  const suggestedBullets = feedback.experienceAndImpact.suggestedBullets.map((bullet, i) => {
    let role = normalizeWhitespace(withoutControlCharacters(bullet.role));
    const parts = role.split(ROLE_SEPARATOR).filter(Boolean);
    const known = parts.length > 0 && parts.every((part) => lettersOf(part).length >= 2 && cvLetters.includes(lettersOf(part)));
    const entry = nearestEntry(role);
    if (!known) {
      const replacement = entry ? entryLabel(entry) : role;
      interventions.push({ check: "bullet-role", action: "text-replaced", path: `experienceAndImpact.suggestedBullets[${i}].role`, value: bullet.role, replacement });
      role = replacement;
    }
    const examples = bullet.examples.map((raw, j) => {
      // The page draws its own marker: "• Designed…" would show two.
      const example = raw.replace(BULLET_START, "");
      const numbers = [...new Set(numbersIn(example))];
      if (numbers.length === 0) return example;
      const words = contentWords(example);
      const candidates = entry?.bullets.length ? entry.bullets : entries.flatMap((one) => one.bullets);
      let source: { text: string; shared: number } | null = null;
      for (const text of candidates) {
        const shared = sharedWords(words, text);
        if (shared >= SOURCE_BULLET_WORDS && (!source || shared > source.shared)) source = { text, shared };
      }
      const scope = source ? [source.text, ...(entry?.header ?? [])].join(" ") : entry ? [...entry.header, ...entry.bullets].join(" ") : cvText;
      const allowed = new Set(numbersIn(scope));
      let text = example;
      for (const number of numbers) {
        if (allowed.has(number)) continue;
        const next = placeholderFor(text, number);
        if (!next) continue;
        text = next;
        interventions.push({ check: "bullet-figure", action: "number-placeheld", path: `experienceAndImpact.suggestedBullets[${i}].examples[${j}]`, value: number, replacement: text });
      }
      return text;
    });
    return role === bullet.role && examples.every((example, j) => example === bullet.examples[j]) ? bullet : { ...bullet, role, examples };
  });

  return { feedback: { ...feedback, experienceAndImpact: { ...feedback.experienceAndImpact, suggestedBullets } }, interventions };
}
