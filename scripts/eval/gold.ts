/**
 * The gold standard for requirement extraction: loads a fixture's gold.json
 * (rules in fixtures/GOLD-RULES.md), locates its spans in the posting, and
 * scores an extracted requirement list against it. Pure apart from the
 * loader; gold.test.ts pins the matcher.
 *
 * Two matchers, in order. Span overlap: the extracted item's text (or, when
 * the arm supplies one, its verbatim source quote) is located in the
 * posting and compared with every gold span by character overlap. Name
 * fallback: when the item cannot be located, the gold item whose normalized
 * name (or an alias) shares enough content words with the item wins. Every
 * match records which matcher made it.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type GoldKind = "required" | "preferred";
export type GoldStatus = "met" | "partial" | "missing";

export type GoldRequirement = {
  id: string;
  kind: GoldKind;
  name: string;
  spans: string[];
  aliases?: string[];
  status?: GoldStatus;
  why?: string;
  contested?: boolean;
  hidden?: boolean;
  splitAllowed?: boolean;
  alsoAcceptedAs?: string[];
};

export type GoldFile = {
  fixture: string;
  status: "final" | "draft";
  requirements: GoldRequirement[];
  notRequirements?: { span: string; reason: string }[];
};

export type Interval = { start: number; end: number };

type LocatedGold = GoldRequirement & {
  intervals: Interval[];
  parts: { text: string; intervals: Interval[] }[];
};

export type Gold = {
  file: GoldFile;
  posting: string;
  normalized: string;
  requirements: LocatedGold[];
  notRequirements: { span: string; reason: string; intervals: Interval[] }[];
};

export type ExtractedItem = {
  requirement: string;
  kind: string;
  status?: string;
  /** The arm's verbatim source quote, when it produces one. */
  source?: string;
};

export type Matcher = "span" | "name";

export type ItemVerdict =
  | { index: number; item: ExtractedItem; outcome: "match"; matcher: Matcher; goldIds: string[]; part?: string; merge: boolean; split: boolean }
  | { index: number; item: ExtractedItem; outcome: "over-extraction"; reason: string; located: boolean }
  | { index: number; item: ExtractedItem; outcome: "invention" };

export type GoldVerdict = {
  id: string;
  found: boolean;
  matcher: Matcher | null;
  kindCorrect: boolean | null;
  statusGold: GoldStatus | null;
  statusGot: string | null;
  statusCorrect: boolean | null;
  statusSevere: boolean;
  contested: boolean;
  hidden: boolean;
};

export type Metrics = {
  goldTotal: number;
  goldFound: number;
  recall: number | null;
  goldUncontested: number;
  goldUncontestedFound: number;
  recallUncontested: number | null;
  hiddenTotal: number;
  hiddenFound: number;
  extracted: number;
  correct: number;
  precision: number | null;
  inventions: number;
  overExtractions: number;
  splits: number;
  merges: number;
  kindTotal: number;
  kindCorrect: number;
  statusTotal: number;
  statusCorrect: number;
  statusSevere: number;
  bySpan: number;
  byName: number;
};

export type Scored = { metrics: Metrics; items: ItemVerdict[]; gold: GoldVerdict[] };

/** Lowercase, NFKC, letters/digits plus the symbols that distinguish C, C++ and C#. */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim();
}

const STOPWORDS = new Set(
  "a an the and or of in on at to for with as by from into is are be been being that this these those you your we our it its their have has had do does experience experienced working knowledge familiarity ability strong solid proven hands hands-on years year plus de la el los las y o en con para un una del al que se es su como experiencia conocimiento".split(
    " ",
  ),
);

function contentWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Every occurrence of `needle` in `haystack`, as intervals. */
function occurrences(haystack: string, needle: string): Interval[] {
  if (!needle) return [];
  const found: Interval[] = [];
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    found.push({ start: at, end: at + needle.length });
    at = haystack.indexOf(needle, at + 1);
  }
  return found;
}

/** Word-aligned occurrences, so "go" does not match inside "mongo". */
function wordOccurrences(haystack: string, needle: string): Interval[] {
  return occurrences(` ${haystack} `, ` ${needle} `).map((one) => ({ start: one.start, end: one.end - 2 }));
}

export type Location = Interval & { exact: boolean; coverage: number };

const ANCHOR_MIN_COVERAGE = 0.4;
const ANCHOR_CLUSTER_GAP = 160;

/**
 * Where an extracted item comes from in the posting: every exact occurrence
 * (a short item like "Python" can sit in a responsibility and in a
 * requirement; the caller prefers the one inside a gold span), or the
 * densest cluster of its word n-grams when the model paraphrased.
 */
export function locateAll(normalizedPosting: string, text: string): Location[] {
  const needle = normalize(text);
  if (!needle) return [];

  const exact = wordOccurrences(normalizedPosting, needle);
  const loose = exact.length ? exact : occurrences(normalizedPosting, needle);
  if (loose.length) return loose.map((one) => ({ ...one, exact: true, coverage: 1 }));

  const anchored = anchor(normalizedPosting, needle);
  return anchored ? [anchored] : [];
}

export function locate(normalizedPosting: string, text: string): Location | null {
  return locateAll(normalizedPosting, text)[0] ?? null;
}

function anchor(normalizedPosting: string, needle: string): Location | null {
  const words = needle.split(" ");
  const n = words.length >= 6 ? 3 : 2;
  if (words.length < n) return null;

  const grams: Interval[][] = [];
  for (let at = 0; at + n <= words.length; at += 1) {
    grams.push(wordOccurrences(normalizedPosting, words.slice(at, at + n).join(" ")));
  }
  const hits = grams.map((found) => found.length > 0);
  const coverage = hits.filter(Boolean).length / grams.length;
  if (coverage < ANCHOR_MIN_COVERAGE) return null;

  // Densest cluster of anchor positions: paraphrases scatter a few n-grams
  // across the posting, and the item lives where most of them sit together.
  const positions = grams.flat().sort((a, b) => a.start - b.start);
  let best: Interval[] = [];
  let current: Interval[] = [];
  for (const position of positions) {
    const last = current[current.length - 1];
    if (last && position.start - last.end > ANCHOR_CLUSTER_GAP) {
      if (current.length > best.length) best = current;
      current = [];
    }
    current.push(position);
  }
  if (current.length > best.length) best = current;
  if (best.length === 0) return null;

  return {
    start: Math.min(...best.map((one) => one.start)),
    end: Math.max(...best.map((one) => one.end)),
    exact: false,
    coverage,
  };
}

const NAME_MIN_SHARE = 0.6;

/** How much of the gold name's content the item carries, or an alias fully carried. */
function nameScore(item: string, gold: GoldRequirement): number {
  const itemWords = new Set(contentWords(item));
  const share = (text: string) => {
    const words = contentWords(text);
    if (words.length === 0) return 0;
    return words.filter((word) => itemWords.has(word)).length / words.length;
  };
  const scores = [share(gold.name), ...(gold.aliases ?? []).map((alias) => (share(alias) === 1 ? 1 : 0))];
  return Math.max(...scores);
}

export async function loadGold(dir: string, posting: string): Promise<Gold | null> {
  const file = path.join(dir, "gold.json");
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(await readFile(file, "utf8")) as GoldFile;
  return buildGold(parsed, posting, path.basename(dir));
}

/** Locates every span; a span that is not verbatim in the posting is a gold error, not a miss. */
export function buildGold(file: GoldFile, posting: string, label = file.fixture): Gold {
  const normalized = normalize(posting);
  const find = (span: string, what: string) => {
    const intervals = occurrences(normalized, normalize(span));
    if (intervals.length === 0) throw new Error(`${label}/gold.json: ${what} is not in job.txt: ${JSON.stringify(span)}`);
    return intervals;
  };

  const requirements = file.requirements.map((requirement) => ({
    ...requirement,
    intervals: requirement.spans.flatMap((span) => find(span, `${requirement.id} span`)),
    parts: (requirement.alsoAcceptedAs ?? []).map((text) => ({ text, intervals: find(text, `${requirement.id} part`) })),
  }));
  const ids = new Set<string>();
  for (const requirement of requirements) {
    if (ids.has(requirement.id)) throw new Error(`${label}/gold.json: duplicate id ${requirement.id}`);
    ids.add(requirement.id);
  }

  return {
    file,
    posting,
    normalized,
    requirements,
    notRequirements: (file.notRequirements ?? []).map((entry) => ({ ...entry, intervals: find(entry.span, "notRequirements span") })),
  };
}

const SPAN_MIN_OVERLAP = 0.5;

function spanMatches(gold: Gold, location: Interval): LocatedGold[] {
  const length = location.end - location.start;
  return gold.requirements.filter((requirement) =>
    requirement.intervals.some((span) => overlap(location, span) >= SPAN_MIN_OVERLAP * Math.min(length, span.end - span.start)),
  );
}

function partOf(requirement: LocatedGold, item: ExtractedItem, location: Interval | null): string | undefined {
  if (requirement.parts.length === 0) return undefined;
  const byText = requirement.parts.find((part) => normalize(item.requirement).includes(normalize(part.text)));
  if (byText) return byText.text;
  if (location) {
    const covering = requirement.parts
      .map((part) => ({ part, covered: Math.max(...part.intervals.map((span) => overlap(location, span))) }))
      .filter((one) => one.covered > 0)
      .sort((a, b) => b.covered - a.covered);
    if (covering.length === 1) return covering[0].part.text;
  }
  const byWords = requirement.parts.find((part) => {
    const words = contentWords(part.text);
    const itemWords = new Set(contentWords(item.requirement));
    return words.length > 0 && words.every((word) => itemWords.has(word));
  });
  return byWords?.text;
}

/** Scores one extracted list against the gold. */
export function score(gold: Gold, items: ExtractedItem[]): Scored {
  const verdicts: ItemVerdict[] = [];
  const matchesByGold = new Map<string, { index: number; part?: string; matcher: Matcher }[]>();

  items.forEach((item, index) => {
    const locations = locateAll(gold.normalized, item.source ?? item.requirement);
    let location: Location | null = locations[0] ?? null;
    let matched: LocatedGold[] = [];
    let matcher: Matcher = "span";
    for (const candidate of locations) {
      matched = spanMatches(gold, candidate);
      if (matched.length) {
        location = candidate;
        break;
      }
    }

    // The name fallback is for items the posting does not contain in those
    // words; an item located in the posting outside every gold span is
    // posting text that is not a requirement, whatever it is named like.
    if (matched.length === 0 && locations.length === 0) {
      const scored = gold.requirements
        .map((requirement) => ({ requirement, score: nameScore(item.requirement, requirement) }))
        .filter((one) => one.score >= NAME_MIN_SHARE)
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        matched = [scored[0].requirement];
        matcher = "name";
      }
    }

    if (matched.length === 0) {
      if (location) {
        const non = gold.notRequirements.find((entry) => entry.intervals.some((span) => overlap(location, span) > 0));
        verdicts.push({ index, item, outcome: "over-extraction", reason: non ? non.reason : "unannotated posting text", located: true });
      } else {
        verdicts.push({ index, item, outcome: "invention" });
      }
      return;
    }

    const primary = matched[0];
    const part = partOf(primary, item, location);
    const earlier = matchesByGold.get(primary.id) ?? [];
    const merge = matched.length > 1;
    const split = !merge && earlier.some((one) => !primary.splitAllowed || !part || !one.part || one.part === part);
    earlier.push({ index, part, matcher });
    matchesByGold.set(primary.id, earlier);
    for (const other of matched.slice(1)) {
      const list = matchesByGold.get(other.id) ?? [];
      list.push({ index, matcher });
      matchesByGold.set(other.id, list);
    }

    verdicts.push({ index, item, outcome: "match", matcher, goldIds: matched.map((one) => one.id), part, merge, split });
  });

  const goldVerdicts: GoldVerdict[] = gold.requirements.map((requirement) => {
    const hits = matchesByGold.get(requirement.id) ?? [];
    const first = hits[0];
    const item = first ? items[first.index] : null;
    const statusGold = requirement.status ?? null;
    const statusGot = item?.status ?? null;
    const statusCorrect = statusGold && statusGot ? statusGot === statusGold : null;
    return {
      id: requirement.id,
      found: hits.length > 0,
      matcher: first?.matcher ?? null,
      kindCorrect: item ? item.kind === requirement.kind : null,
      statusGold,
      statusGot,
      statusCorrect,
      statusSevere: statusCorrect === false && ((statusGold === "met" && statusGot === "missing") || (statusGold === "missing" && statusGot === "met")),
      contested: requirement.contested === true,
      hidden: requirement.hidden === true,
    };
  });

  const matches = verdicts.filter((one): one is Extract<ItemVerdict, { outcome: "match" }> => one.outcome === "match");
  const uncontested = goldVerdicts.filter((one) => !one.contested);
  const hidden = goldVerdicts.filter((one) => one.hidden);
  const kindJudged = goldVerdicts.filter((one) => one.kindCorrect !== null);
  const statusJudged = goldVerdicts.filter((one) => one.statusCorrect !== null);
  const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

  const metrics: Metrics = {
    goldTotal: goldVerdicts.length,
    goldFound: goldVerdicts.filter((one) => one.found).length,
    recall: ratio(goldVerdicts.filter((one) => one.found).length, goldVerdicts.length),
    goldUncontested: uncontested.length,
    goldUncontestedFound: uncontested.filter((one) => one.found).length,
    recallUncontested: ratio(uncontested.filter((one) => one.found).length, uncontested.length),
    hiddenTotal: hidden.length,
    hiddenFound: hidden.filter((one) => one.found).length,
    extracted: items.length,
    correct: matches.filter((one) => !one.split).length,
    precision: ratio(matches.filter((one) => !one.split).length, items.length),
    inventions: verdicts.filter((one) => one.outcome === "invention").length,
    overExtractions: verdicts.filter((one) => one.outcome === "over-extraction").length,
    splits: matches.filter((one) => one.split).length,
    merges: matches.filter((one) => one.merge).length,
    kindTotal: kindJudged.length,
    kindCorrect: kindJudged.filter((one) => one.kindCorrect).length,
    statusTotal: statusJudged.length,
    statusCorrect: statusJudged.filter((one) => one.statusCorrect).length,
    statusSevere: goldVerdicts.filter((one) => one.statusSevere).length,
    bySpan: goldVerdicts.filter((one) => one.matcher === "span").length,
    byName: goldVerdicts.filter((one) => one.matcher === "name").length,
  };

  return { metrics, items: verdicts, gold: goldVerdicts };
}

/** Sums the counts of several scored lists; rates are recomputed from the sums. */
export function sumMetrics(all: Metrics[]): Metrics {
  const total = (pick: (m: Metrics) => number) => all.reduce((sum, m) => sum + pick(m), 0);
  const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
  const goldTotal = total((m) => m.goldTotal);
  const goldFound = total((m) => m.goldFound);
  const goldUncontested = total((m) => m.goldUncontested);
  const goldUncontestedFound = total((m) => m.goldUncontestedFound);
  const extracted = total((m) => m.extracted);
  const correct = total((m) => m.correct);
  return {
    goldTotal,
    goldFound,
    recall: ratio(goldFound, goldTotal),
    goldUncontested,
    goldUncontestedFound,
    recallUncontested: ratio(goldUncontestedFound, goldUncontested),
    hiddenTotal: total((m) => m.hiddenTotal),
    hiddenFound: total((m) => m.hiddenFound),
    extracted,
    correct,
    precision: ratio(correct, extracted),
    inventions: total((m) => m.inventions),
    overExtractions: total((m) => m.overExtractions),
    splits: total((m) => m.splits),
    merges: total((m) => m.merges),
    kindTotal: total((m) => m.kindTotal),
    kindCorrect: total((m) => m.kindCorrect),
    statusTotal: total((m) => m.statusTotal),
    statusCorrect: total((m) => m.statusCorrect),
    statusSevere: total((m) => m.statusSevere),
    bySpan: total((m) => m.bySpan),
    byName: total((m) => m.byName),
  };
}

export const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(0)}%`);
