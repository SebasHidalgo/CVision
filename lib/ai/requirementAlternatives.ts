import { containsTerm, unshowableAlternativeIn } from "@/lib/ai/requirementGuardrails";
import type { Intervention } from "@/lib/ai/analysisGuardrails";
import { loosen, normalizeWhitespace } from "@/lib/ai/analysisChecks";
import type { KeyTerms } from "@/lib/schemas/resumeSchema";

// M8-G: the alternatives a posting quote offers, read in code, and what they mean for key terms. Pure; tested.

/** One verbatim alternative; elliptical when it borrows its noun from the next one ("data" of "data or business analyst"). */
export type Alternative = { text: string; elliptical: boolean };

// Words that end an item read backwards from "or", or forwards after it.
const BOUNDARY = new Set(
  "a an the of in with for as at on to from by into using including such like e.g. eg. i.e. ie. de del en con para por como el la los las un una al and y e".split(" "),
);
const OR = /\s+(?:or|o|u)\s+/giu;
// Bare "como" is usually "as" ("como analista"), not "such as".
const EXAMPLES = /(?:such as|e\.g\.,?|for example,?|like|including|tales como|por ejemplo,?)\s+/iu;
// Alternatives no word in a CV can show; the model and the related-field rule judge them.
const OPEN_ALTERNATIVE = /\b(?:equivalent|equivalente|related|relacionad\p{L}*|af[ií]n(?:es)?|similar|comparable)\b/iu;
const MAX_ITEM_WORDS = 4;

const words = (text: string) => normalizeWhitespace(text).split(" ").filter(Boolean);
const isBoundary = (word: string) => BOUNDARY.has(word.toLowerCase());

/** The words at the end of a chunk after its last function word: "experience as a data" -> "data". */
function tail(chunk: string): string {
  const all = words(chunk);
  let start = all.length;
  while (start > 0 && all.length - start < MAX_ITEM_WORDS && !isBoundary(all[start - 1])) start -= 1;
  return all.slice(start).join(" ");
}

/** The words at the start of a chunk before its first function word: "Beam for large-scale processing" -> "Beam". */
function head(chunk: string): string {
  const all = words(chunk);
  let end = 0;
  while (end < all.length && end < MAX_ITEM_WORDS && !isBoundary(all[end])) end += 1;
  return all.slice(0, end).join(" ");
}

const clean = (item: string) => item.replace(/^[\s,:;"'“”]+|[\s,:;"'“”]+$/g, "");

// M8-H: words that introduce examples of a category, not alternatives to it.
const MARKER_WORDS = "e\\.g\\.|eg\\.|for example|for instance|such as|including,? but not limited to|tales como|por ejemplo|incluyendo|like|como|including";
const EXAMPLE_MARKER = new RegExp(`(?<![\\p{L}.])(${MARKER_WORDS})[\\s,:]*`, "giu");
const EXAMPLE_START = new RegExp(`^\\s*(?:${MARKER_WORDS})[\\s,:]*`, "iu");

/** "like" and "como" mark examples only before a name, a bare "including" only before a comma list: "including monitoring and telemetry" joins subjects. */
function marksExamples(quote: string, match: RegExpExecArray | RegExpMatchArray): boolean {
  const word = match[1].toLowerCase();
  const after = quote.slice((match.index ?? 0) + match[0].length);
  // Case-sensitive on purpose: under the i flag \p{Lu} matches lowercase too.
  if (word === "like" || word === "como") return /^\p{Lu}/u.test(after);
  if (word === "including") return /^[^,.;()]*,/.test(after);
  return true;
}
const LIST_SEPARATOR = /(,\s*(?:(?:and|or|y|o|u|e)\s+)?|\s+(?:and\/or|and|or|y|o|u|e)\s+|\s*\/\s*)/iu;

/** Where a list of short items starting at `from` ends; 0 items when the text there is not a list. */
function listFrom(text: string, from: number): { end: number; items: number } {
  const rest = text.slice(from);
  const stop = rest.search(/[;()]|[.!?](?:\s|$)/);
  const clause = stop < 0 ? rest : rest.slice(0, stop);
  const parts = clause.split(LIST_SEPARATOR);
  let offset = 0;
  let end = from;
  let items = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const item = clean(parts[i]);
    if (!item || words(item).length > MAX_ITEM_WORDS || words(item).some(isBoundary) || OPEN_ALTERNATIVE.test(item)) break;
    end = from + offset + parts[i].trimEnd().length;
    items += 1;
    offset += parts[i].length + (parts[i + 1]?.length ?? 0);
  }
  return { end, items };
}

/** A span of a quote that lists examples: `start` at the marker or "(", the list between `from` and `end`. */
export type ExampleSpan = { start: number; from: number; end: number };

/** The examples a quote gives: a marked list ("such as Airflow or Dagster") or a parenthesised one ("(BigQuery, Snowflake)"). */
export function exampleSpans(quote: string): ExampleSpan[] {
  const spans: ExampleSpan[] = [];
  const parenthesised: [number, number][] = [];
  for (const match of quote.matchAll(/\(([^()]*)\)/g)) {
    const open = match.index ?? 0;
    parenthesised.push([open, open + match[0].length]);
    const marker = EXAMPLE_START.exec(match[1]);
    const from = open + 1 + (marker ? marker[0].length : 0);
    const list = listFrom(quote, from);
    // A lone item is an aside ("(BSc)"), unless the posting marks it as an example.
    if (list.items >= (marker ? 1 : 2)) spans.push({ start: open, from, end: list.end });
  }
  for (const match of quote.matchAll(EXAMPLE_MARKER)) {
    const at = match.index ?? 0;
    if (parenthesised.some(([open, close]) => at > open && at < close) || !marksExamples(quote, match)) continue;
    const from = at + match[0].length;
    const list = listFrom(quote, from);
    if (list.items >= 1) spans.push({ start: at, from, end: list.end });
  }
  return spans.sort((a, b) => a.start - b.start);
}

// Typography a model may normalise in a term: dashes, quotes, no-break spaces. One unit for one unit, so positions hold.
const foldTypography = (text: string) =>
  Array.from(
    text.replace(/[‐-―−]/g, "-").replace(/[‘’‛′]/g, "'").replace(/[“”]/g, '"').replace(/ /g, " "),
    (char) => (char.toLowerCase().length === char.length ? char.toLowerCase() : char),
  ).join("");

/** Where a term starts in a quote as a whole token ("C" never inside "technical"), ignoring case and typography; -1 when it is not there. */
export function locateTerm(quote: string, term: string): number {
  const wanted = foldTypography(normalizeWhitespace(term));
  if (!wanted) return -1;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return foldTypography(quote).search(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u"));
}

/** A comma list split into items: "Azure, AWS, GCP" or "Redis, Kafka and Celery". */
const listItems = (text: string) =>
  text
    .split(/,|\s+(?:and|or|y|o|u|e)\s+/iu)
    .map(clean)
    .filter((item) => item && words(item).length <= MAX_ITEM_WORDS);

/** Items joined by "or" in one clause, with the comma-listed items before them. */
function orSets(clause: string): Alternative[][] {
  const sets: Alternative[][] = [];
  const matches = [...clause.matchAll(OR)];
  matches.forEach((match, i) => {
    const before = clause.slice(i === 0 ? 0 : (matches[i - 1].index ?? 0) + matches[i - 1][0].length, match.index);
    const after = clause.slice((match.index ?? 0) + match[0].length, matches[i + 1]?.index ?? clause.length);
    const right = clean(head(after.split(",")[0]));
    const chunks = before.split(",");
    const left: string[] = [];
    for (let c = chunks.length - 1; c >= 0; c -= 1) {
      const chunk = chunks[c];
      const item = clean(tail(chunk));
      if (item) left.unshift(item);
      // A chunk with a function word starts the sentence the list sits in: stop there.
      if (words(chunk).some(isBoundary) || words(chunk).length > MAX_ITEM_WORDS) break;
    }
    if (!right || left.length === 0) return;
    const elliptical = left.length === 1 && chunks.length === 1 && words(left[0]).length === 1 && words(right).length > 1;
    sets.push([...left.map((text, k) => ({ text, elliptical: elliptical && k === left.length - 1 })), { text: right, elliptical: false }]);
  });
  return sets;
}

/**
 * The alternatives a quote offers, one set per list: items joined by "or"/"o"/"u" ("a data or business
 * analyst", "Spark, Flink or Beam"), a parenthesised list ("(BigQuery, Snowflake or Redshift)") and an
 * examples list ("such as Airflow or Dagster", "como Power BI o Looker"). Every item is verbatim in the quote.
 */
export function quoteAlternatives(quote: string): Alternative[][] {
  const sets: Alternative[][] = [];
  const outside = quote.replace(/\(([^()]*)\)/g, (_, inner: string) => {
    const items = listItems(inner.replace(EXAMPLES, ""));
    if (items.length > 1) sets.push(items.map((text) => ({ text, elliptical: false })));
    return " ; ";
  });
  for (const clause of outside.split(/[;.!?](?:\s|$)/)) {
    const examples = EXAMPLES.exec(clause);
    if (examples) {
      const items = listItems(clause.slice((examples.index ?? 0) + examples[0].length));
      if (items.length > 1) sets.push(items.map((text) => ({ text, elliptical: false })));
      continue;
    }
    sets.push(...orSets(clause));
  }
  return sets.filter((set) => set.every((item) => quote.includes(item.text)));
}

const overlaps = (a: string, b: string) => containsTerm(a, b) || containsTerm(b, a);

export type AlternativesOutcome = { keyTerms: KeyTerms; unexamined: string[]; interventions: Intervention[] };

/**
 * Adds the alternatives the model's key terms left out of a list they belong to. One the CV states
 * verbatim is added as shown; one it does not is added as absent, unless the code cannot look for it
 * (the CV is in another language than the posting, or the item borrows its noun): that one is unexamined.
 */
export function withQuoteAlternatives(
  keyTerms: KeyTerms,
  quote: string,
  cvText: string,
  crossLanguage: boolean,
  path: string,
): AlternativesOutcome {
  const terms = keyTerms.terms.map((term) => ({ ...term }));
  const unexamined: string[] = [];
  const interventions: Intervention[] = [];
  if (terms.length === 0) return { keyTerms, unexamined, interventions };
  // "or willingness to learn it" is the unshowable-alternative rule's, not a term.
  const unshowable = unshowableAlternativeIn(quote);
  for (const set of quoteAlternatives(unshowable ? quote.replace(unshowable, "") : quote)) {
    if (!set.some((item) => terms.some((term) => overlaps(term.term, item.text)))) continue;
    for (const item of set) {
      if (OPEN_ALTERNATIVE.test(item.text) || terms.some((term) => overlaps(term.term, item.text))) continue;
      // An elided item is not the thing itself ("data" of "data analyst"): never looked up, never shown.
      if (item.elliptical) {
        unexamined.push(item.text);
      } else if (containsTerm(cvText, item.text)) {
        terms.push({ term: item.text, cvMatch: item.text, relation: "same" });
        interventions.push({ check: "key-term", action: "alternative-added", path, value: item.text, replacement: "shown" });
      } else if (crossLanguage) {
        unexamined.push(item.text);
      } else {
        terms.push({ term: item.text, cvMatch: "", relation: "none" });
        interventions.push({ check: "key-term", action: "alternative-added", path, value: item.text, replacement: "not shown" });
      }
    }
  }
  return { keyTerms: { ...keyTerms, terms }, unexamined, interventions };
}

const DEGREE = /\b(?:degree|bachelor\p{L}*|master\p{L}*|b\.?sc|m\.?sc|ph\.?d|diploma|licenciatura|t[ií]tulo|grado|ingenier[ií]a|carrera)\b/iu;
const RELATED_FIELD =
  /\brelated(?:\s+(?:technical|technology|scientific|quantitative|engineering))?\s+(?:fields?|disciplines?|areas?|subjects?|majors?|degrees?)\b|\b(?:campos?|carreras?|áreas?|disciplinas?)\s+afines?\b|\bafines\b/iu;

/** The quote's verbatim "related field" when it is a degree requirement that accepts one. */
export function relatedFieldIn(quote: string): string | null {
  if (!DEGREE.test(quote)) return null;
  return RELATED_FIELD.exec(quote)?.[0] ?? null;
}

/**
 * A degree term "shown" by a different discipline names the wrong thing: "Computer Science ✓ (Computer Systems
 * Engineering)". When the posting accepts a related field, the match moves to that phrase and the named discipline reads as absent.
 */
export function withRelatedField(keyTerms: KeyTerms, quote: string, path: string): { keyTerms: KeyTerms; interventions: Intervention[] } {
  const related = relatedFieldIn(quote);
  if (!related) return { keyTerms, interventions: [] };
  const terms = keyTerms.terms.map((term) => ({ ...term }));
  const interventions: Intervention[] = [];
  const same = (a: string, b: string) => loosen(a).toLowerCase().includes(loosen(b).toLowerCase()) || loosen(b).toLowerCase().includes(loosen(a).toLowerCase());
  for (const term of terms) {
    if (!normalizeWhitespace(term.cvMatch) || overlaps(term.term, related) || same(term.term, term.cvMatch)) continue;
    const target = terms.find((other) => overlaps(other.term, related));
    // Another discipline is an instance of the related field the posting accepts.
    if (target) {
      if (!normalizeWhitespace(target.cvMatch)) Object.assign(target, { cvMatch: term.cvMatch, relation: "same" });
    } else {
      terms.push({ term: related, cvMatch: term.cvMatch, relation: "same" });
    }
    interventions.push({ check: "key-term", action: "match-dropped", path, value: `${term.term}: ${term.cvMatch}`, replacement: related });
    term.cvMatch = "";
    term.relation = "related";
  }
  return interventions.length ? { keyTerms: { ...keyTerms, terms }, interventions } : { keyTerms, interventions };
}
