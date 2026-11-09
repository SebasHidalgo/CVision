import { loosen, normalizeWhitespace } from "@/lib/ai/analysisChecks";
import type { Intervention } from "@/lib/ai/analysisGuardrails";
import { inPosting, namesQualifications } from "@/lib/ai/requirementGuardrails";
import type { ModelRequirement } from "@/lib/schemas/resumeSchema";

// M8-F: every bullet under a qualifications heading must be covered by an extracted entry. Pure; tested.

/** A bullet under a heading that introduces qualifications, located in the whitespace-collapsed posting. */
export type PostingBullet = { text: string; heading: string; start: number; end: number };

const MARKER = /^\s*(?:[•·▪◦‣∙*–—-]|\d{1,2}[.)])\s+/u;
// An unmarked line this long is a paragraph, not a list item.
const MAX_ITEM_CHARS = 300;
const MAX_HEADING_CHARS = 60;
const MAX_HEADING_WORDS = 8;

/** "## Requirements", "**What you bring:**", "Requisitos:" -> the heading's words; null for any other line. */
export function headingOf(line: string): string | null {
  if (!line.trim() || MARKER.test(line) || /^\s/.test(line) || /^\p{Ll}/u.test(line.trim())) return null;
  const bare = line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^\*\*(.*)\*\*:?$/, "$1")
    .replace(/:$/, "")
    .trim();
  if (!bare || bare.length > MAX_HEADING_CHARS || /[.;!?,]$/.test(bare)) return null;
  return bare.split(/\s+/).length <= MAX_HEADING_WORDS ? bare : null;
}

// "Additional information", "Perks & benefits": headings with a qualification word that introduce none.
const NOT_QUALIFICATIONS =
  /\binfo(?:rmation)?\b|\bdetails\b|benefit|perk|we offer|ofrecemos|beneficios|about (?:us|the|our)|equal|salary|compensation|how we hire|process/i;

/** A heading that introduces qualifications, by the same words that decide `kind`. */
export const introducesQualifications = (heading: string) => namesQualifications(heading) && !NOT_QUALIFICATIONS.test(heading);

/**
 * The bullets under each qualifications heading: marked lines with their wrapped continuations, or,
 * in a list without markers, each line of the block up to the next heading. Prose after a marked list ends it.
 */
export function postingBullets(posting: string): PostingBullet[] {
  const lines = posting.split(/\r?\n/);
  const items: { text: string; heading: string }[] = [];
  let heading: string | null = null;
  let marked: boolean | null = null;
  let current: string[] | null = null;
  let blankSince = false;

  const flush = () => {
    if (current && heading) items.push({ text: normalizeWhitespace(current.join(" ")), heading });
    current = null;
  };
  const close = () => {
    flush();
    heading = null;
  };

  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text) {
      blankSince = true;
      return;
    }
    const hasMarker = MARKER.test(line);
    const previous = current ? current[current.length - 1] : "";
    // A wrapped item: indented, lowercase, or after a line that cannot end one.
    const continues =
      current !== null && !hasMarker && !blankSince &&
      (/^\s/.test(line) || /^\p{Ll}/u.test(text) || /(?:[,;:–—-]|\b(?:and|or|to|of|in|with|for|y|o|de|en|con|para))$/iu.test(previous));
    if (continues) {
      current!.push(text);
      return;
    }
    // The first line is the job title.
    const asHeading = index > 0 && !hasMarker ? headingOf(line) : null;
    if (asHeading) {
      flush();
      heading = introducesQualifications(asHeading) ? asHeading : null;
      marked = null;
      blankSince = false;
      return;
    }
    blankSince = false;
    if (!heading) return;
    if (marked === null) marked = hasMarker;
    if (hasMarker) {
      flush();
      current = [text.replace(MARKER, "")];
    } else if (marked) {
      // Prose after a marked list closes the block.
      close();
    } else {
      flush();
      if (text.length <= MAX_ITEM_CHARS) current = [text];
    }
  });
  flush();

  const flat = normalizeWhitespace(posting);
  const located: PostingBullet[] = [];
  let cursor = 0;
  for (const item of items) {
    if (!item.text) continue;
    const start = flat.indexOf(item.text, cursor);
    if (start < 0) continue;
    located.push({ ...item, start, end: start + item.text.length });
    cursor = start + item.text.length;
  }
  return located;
}

/** Where each entry's posting quotes sit in the flattened posting; quotes the posting does not have cover nothing. */
export function coveredSpans(posting: string, entries: Pick<ModelRequirement, "sourceQuote" | "softenedClause">[]): [number, number][] {
  const flat = normalizeWhitespace(posting);
  const spans: [number, number][] = [];
  for (const entry of entries) {
    for (const quote of [entry.sourceQuote, entry.softenedClause.quote]) {
      if (!normalizeWhitespace(quote)) continue;
      const found = inPosting(posting, quote);
      if (!found) continue;
      const at = flat.indexOf(found.text);
      if (at >= 0) spans.push([at, at + found.text.length]);
    }
  }
  return spans;
}

// Overlap that counts as covering: a short bullet needs half of it, a long one this many characters.
const MIN_OVERLAP = 12;

export const covers = (span: [number, number], bullet: Pick<PostingBullet, "start" | "end">) =>
  Math.min(span[1], bullet.end) - Math.max(span[0], bullet.start) >= Math.min(MIN_OVERLAP, Math.ceil((bullet.end - bullet.start) / 2));

/**
 * Qualification bullets no entry's posting quote overlaps. An entry the code later drops as a
 * description still covers its bullet: the model read it and classified it.
 */
export function uncoveredBullets(posting: string, entries: Pick<ModelRequirement, "sourceQuote" | "softenedClause">[]): PostingBullet[] {
  const spans = coveredSpans(posting, entries);
  return postingBullets(posting).filter((bullet) => !spans.some((span) => covers(span, bullet)));
}

/** The repair call's outcome: its entries, or null when it failed. */
export type RepairAnswer = { requirements: ModelRequirement[] | null; error?: string };

/**
 * The model's entries with the repair's merged in, in posting order. A repair entry counts only when
 * it covers a skipped line; one that copies a listed requirement's text is a restatement and covers
 * its line without adding an entry.
 */
export function mergeRepair(
  posting: string,
  entries: ModelRequirement[],
  repair: RepairAnswer | undefined,
): { requirements: ModelRequirement[]; uncovered: PostingBullet[]; interventions: Intervention[] } {
  const uncovered = uncoveredBullets(posting, entries);
  const interventions: Intervention[] = uncovered.map((bullet) => ({
    check: "requirement-coverage",
    action: "requirement-uncovered",
    path: "jobFit.requirements",
    value: bullet.text,
  }));
  if (uncovered.length === 0 || !repair) return { requirements: entries, uncovered, interventions };
  if (!repair.requirements) {
    interventions.push({ check: "requirement-coverage", action: "recorded", path: "jobFit.requirements", value: `${uncovered.length} line(s)`, replacement: `repair failed: ${repair.error ?? "unknown"}` });
    return { requirements: entries, uncovered, interventions };
  }

  const flat = normalizeWhitespace(posting);
  const at = (entry: ModelRequirement) => {
    const found = inPosting(posting, entry.sourceQuote);
    return found ? flat.indexOf(found.text) : -1;
  };
  const listed = new Set(entries.map((entry) => loosen(entry.requirement)).filter(Boolean));
  const merged = [...entries];
  const how = new Map<PostingBullet, string>();
  for (const entry of repair.requirements) {
    const spans = coveredSpans(posting, [entry]);
    const lines = uncovered.filter((bullet) => spans.some((span) => covers(span, bullet)));
    if (lines.length === 0) {
      interventions.push({ check: "requirement-coverage", action: "recorded", path: "jobFit.requirements", value: entry.sourceQuote, replacement: "repair entry outside the skipped lines" });
      continue;
    }
    const restated = listed.has(loosen(entry.requirement));
    const kind = restated ? "restates a listed requirement" : entry.section === "description" ? "not a requirement" : "requirement added";
    for (const line of lines) if (!how.has(line)) how.set(line, kind);
    if (restated) continue;
    const position = at(entry);
    const before = merged.findIndex((other) => at(other) > position);
    merged.splice(before < 0 ? merged.length : before, 0, entry);
  }
  for (const [line, kind] of how) {
    interventions.push({ check: "requirement-coverage", action: "requirement-recovered", path: "jobFit.requirements", value: line.text, replacement: kind });
  }
  return { requirements: merged, uncovered, interventions };
}
