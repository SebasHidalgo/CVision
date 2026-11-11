import type { ProseMap } from "@/lib/ai/translatableProse";

/**
 * Checks on each translated string, in code. A string that fails any check keeps its English
 * original: the user never sees a translation that changed a figure, a technology, a quote or the
 * meaning's size. Pure; tested.
 */

export const TRANSLATION_CHECKS = ["missing", "empty", "digits", "protected-term", "quote", "length", "unchanged"] as const;
export type TranslationCheck = (typeof TRANSLATION_CHECKS)[number];

export type TranslationGuardStats = {
  strings: number;
  kept: number;
  counts: Partial<Record<TranslationCheck, number>>;
  /** Which string failed which check; never the text. */
  failures: Array<{ path: string; check: TranslationCheck }>;
  /** Protected terms found in a source string, and how many came through verbatim. */
  protectedTerms: { present: number; preserved: number };
  /** Digit groups in the sources, and how many came through. */
  digits: { present: number; preserved: number };
};

/** Digit groups, separators aside: "2.5" and "2,5" are the same figures. */
const digitGroups = (text: string): string[] => [...(text.match(/\d+/g) ?? [])].sort();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole-token match, case-sensitive: "Go" is not in "Google", "C" is not in "CI".
const tokenPattern = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "u");

/** The text inside quotation marks; a straight single quote counts only when it reads as a quote, not an apostrophe. */
export function quotedSpans(text: string): string[] {
  const spans: string[] = [];
  for (const pattern of [/"([^"\n]{2,})"/g, /“([^”\n]{2,})”/g, /‘([^’\n]{2,})’/g, /«([^»\n]{2,})»/g, /(?<![\p{L}\p{N}])'([^'\n]{2,}?)'(?![\p{L}\p{N}])/gu]) {
    for (const match of text.matchAll(pattern)) spans.push(match[1]);
  }
  return spans;
}

const LENGTH_RATIO = { short: [0.4, 3], long: [0.6, 2] } as const;
const SHORT = 40;

/** The checks one string fails. */
export function checkTranslation(source: string, translated: string | undefined, protectedTerms: readonly string[]): TranslationCheck[] {
  if (translated === undefined) return ["missing"];
  const text = translated.trim();
  if (!text) return ["empty"];
  const failed: TranslationCheck[] = [];
  if (digitGroups(source).join() !== digitGroups(text).join()) failed.push("digits");
  if (protectedTerms.some((term) => tokenPattern(term).test(source) && !tokenPattern(term).test(text))) failed.push("protected-term");
  if (quotedSpans(source).some((span) => !text.includes(span))) failed.push("quote");
  const [low, high] = source.length < SHORT ? LENGTH_RATIO.short : LENGTH_RATIO.long;
  if (text.length < source.length * low || text.length > source.length * high) failed.push("length");
  // An untranslated sentence is not an error to hide, but it is not a translation: counted, and the original shows.
  if (text === source.trim() && source.trim().split(/\s+/).length >= 4) failed.push("unchanged");
  return failed;
}

/** Keeps the strings that pass every check; reports the rest by path and check. */
export function guardTranslations(
  sources: ProseMap,
  translated: ProseMap,
  protectedTerms: readonly string[],
): { kept: ProseMap; stats: TranslationGuardStats } {
  const kept: ProseMap = {};
  const stats: TranslationGuardStats = { strings: 0, kept: 0, counts: {}, failures: [], protectedTerms: { present: 0, preserved: 0 }, digits: { present: 0, preserved: 0 } };
  for (const [path, source] of Object.entries(sources)) {
    stats.strings += 1;
    const text = translated[path];
    for (const term of protectedTerms) {
      if (!tokenPattern(term).test(source)) continue;
      stats.protectedTerms.present += 1;
      if (text !== undefined && tokenPattern(term).test(text)) stats.protectedTerms.preserved += 1;
    }
    const groups = digitGroups(source);
    const remaining = digitGroups(text ?? "");
    stats.digits.present += groups.length;
    for (const group of groups) {
      const at = remaining.indexOf(group);
      if (at >= 0) {
        stats.digits.preserved += 1;
        remaining.splice(at, 1);
      }
    }
    const failed = checkTranslation(source, text, protectedTerms);
    if (failed.length === 0) {
      kept[path] = text!.trim();
      stats.kept += 1;
      continue;
    }
    for (const check of failed) {
      stats.counts[check] = (stats.counts[check] ?? 0) + 1;
      stats.failures.push({ path, check });
    }
  }
  return { kept, stats };
}
