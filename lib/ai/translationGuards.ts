import type { TargetLocale } from "@/lib/ai/prompts/translation.prompt";
import type { ProseMap } from "@/lib/ai/translatableProse";
import { alreadyInTarget, tokenPattern } from "@/lib/ai/translationTerms";

/**
 * Checks on each translated string and term, in code. Hard checks protect what must not change
 * (figures, names, quotes, the meaning's size); a string that still fails one after the retries keeps
 * its English original. Soft checks catch what reads wrong (an English concept left in, the third
 * person); they are retried too, and after the retries the translation is kept. Pure; tested.
 */

export const TRANSLATION_CHECKS = ["missing", "empty", "digits", "name", "quote", "length", "unchanged", "english-left", "english-term", "third-person"] as const;
export type TranslationCheck = (typeof TRANSLATION_CHECKS)[number];
export const SOFT_CHECKS: readonly TranslationCheck[] = ["english-term", "third-person"];

export type Concept = { term: string; text: string };

export type GuardContext = {
  locale: TargetLocale;
  /** Terms kept verbatim: technologies, products, companies, institutions, people. */
  names: readonly string[];
  /** Translated terms: their English must not survive in the prose. */
  concepts: readonly Concept[];
  /** Interface labels a string may quote, English → target ("Not shown in your CV" → "No aparece en tu CV"). */
  labels: ReadonlyMap<string, string>;
};

export type Failure = { check: TranslationCheck; items?: string[] };

/** Digit groups, separators aside: "2.5" and "2,5" are the same figures. */
export const digitGroups = (text: string): string[] => [...(text.match(/\d+/g) ?? [])].sort();

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

const THIRD_PERSON: Record<TargetLocale, RegExp> = {
  es: /(?<![\p{L}])(?:el candidato|la candidata|los candidatos|usted|su (?:CV|currículum|curriculum|perfil|trayectoria))(?![\p{L}])/iu,
};

const SOURCE_FUNCTION_WORDS = /(?<!\p{L})(?:the|and|with|for|of|to|your|you|is|are|in|an|as|this|that|will|be|by|from|on|its|it|has|have)(?!\p{L})/giu;
const TARGET_FUNCTION_WORDS: Record<TargetLocale, RegExp> = {
  es: /(?<!\p{L})(?:el|la|los|las|de|del|que|y|e|con|para|por|una|un|en|es|se|al|como|tu|tus|lo|le|su|sus)(?!\p{L})/giu,
};
const QUOTED_TEXT = /"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|«[^»\n]*»|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;

/** A sentence of the answer still in English (quotes and names aside): a translation left half done. */
function englishLeft(text: string, locale: TargetLocale): boolean {
  return text
    .replace(QUOTED_TEXT, " ")
    .split(/(?<=[.!?;:])\s+/u)
    .some((sentence) => {
      const english = sentence.match(SOURCE_FUNCTION_WORDS)?.length ?? 0;
      const target = sentence.match(TARGET_FUNCTION_WORDS[locale])?.length ?? 0;
      return english >= 3 && english > target;
    });
}

const withoutNames = (text: string, names: readonly string[]) =>
  names.reduce((rest, name) => rest.replace(new RegExp(tokenPattern(name).source, "gu"), " "), text);

/** The checks one string fails, with what each one is about (for the retry's instructions). */
export function checkTranslation(source: string, translated: string | undefined, context: GuardContext): Failure[] {
  if (translated === undefined) return [{ check: "missing" }];
  const text = translated.trim();
  if (!text) return [{ check: "empty" }];
  const failed: Failure[] = [];
  if (digitGroups(source).join() !== digitGroups(text).join()) failed.push({ check: "digits", items: [...new Set(digitGroups(source))] });
  const lostNames = context.names.filter((name) => tokenPattern(name).test(source) && !tokenPattern(name).test(text));
  if (lostNames.length) failed.push({ check: "name", items: lostNames });
  const lostQuotes = quotedSpans(source).filter((span) => {
    if (text.includes(span)) return false;
    const label = context.labels.get(span);
    return !(label && text.includes(label));
  });
  if (lostQuotes.length) {
    const hint = (span: string) => (context.labels.has(span) ? `"${span}" (an interface label: write it as "${context.labels.get(span)}")` : `"${span}"`);
    failed.push({ check: "quote", items: lostQuotes.map(hint) });
  }
  const [low, high] = source.length < SHORT ? LENGTH_RATIO.short : LENGTH_RATIO.long;
  if (text.length < source.length * low || text.length > source.length * high) failed.push({ check: "length" });
  // Names and figures read the same in every language: a string of only those may come back as it was.
  const prose = withoutNames(source, context.names).replace(/\d+/g, " ");
  if (text.toLowerCase() === source.trim().toLowerCase() && (prose.match(/\p{L}{2,}/gu) ?? []).length >= 2) failed.push({ check: "unchanged" });
  else if (englishLeft(withoutNames(text, context.names), context.locale)) failed.push({ check: "english-left" });
  const rest = withoutNames(text, context.names);
  // A concept whose own translation is still pending (empty text) counts too: both are retried together.
  const english = context.concepts.filter(
    ({ term, text: target }) =>
      term.toLowerCase() !== target.toLowerCase() && tokenPattern(term, "iu").test(source) && tokenPattern(term, "iu").test(rest),
  );
  if (english.length) failed.push({ check: "english-term", items: english.map(({ term, text: target }) => `${term} → ${target || "its translation"}`) });
  if (THIRD_PERSON[context.locale].test(text)) failed.push({ check: "third-person" });
  return failed;
}

/** A concept's translation is usable when it is there, keeps its figures and the names inside it, and is not a sentence. */
export function checkTerm(term: string, text: string | undefined, names: readonly string[], locale: TargetLocale = "es"): Failure[] {
  if (text === undefined) return [{ check: "missing" }];
  const target = text.trim();
  if (!target) return [{ check: "empty" }];
  const failed: Failure[] = [];
  if (digitGroups(term).join() !== digitGroups(target).join()) failed.push({ check: "digits" });
  const lostNames = names.filter((name) => name !== term && tokenPattern(name).test(term) && !tokenPattern(name).test(target));
  if (lostNames.length) failed.push({ check: "name", items: lostNames });
  if (target.length > term.length * 3 + 12) failed.push({ check: "length" });
  // A concept of several words that comes back as it was was not translated ("Computer Science"), unless it already was.
  const unchanged = target.toLowerCase() === term.trim().toLowerCase() && !alreadyInTarget(term, locale);
  if (unchanged && (term.match(/\p{L}{2,}/gu) ?? []).length >= 2) failed.push({ check: "unchanged" });
  return failed;
}

export const isHard = (failure: Failure) => !SOFT_CHECKS.includes(failure.check);

/** What a retry tells the model about a string that failed. */
export function fixInstructions(failures: Failure[]): string[] {
  return failures.map(({ check, items }) => {
    // Quote items come formatted (with their label hint); the rest are quoted here.
    const list = (items ?? []).map((item) => (check === "quote" ? item : `"${item}"`)).join(", ");
    switch (check) {
      case "missing":
      case "empty":
        return "it came back empty; translate it";
      case "digits":
        return `keep every figure exactly${list ? `: ${list}` : ""}`;
      case "name":
        return `copy these names exactly as written: ${list}`;
      case "quote":
        return `copy the text inside quotation marks exactly as written: ${list}`;
      case "length":
        return "it came back much longer or shorter than the original; translate it whole, about as long";
      case "unchanged":
        return "it came back in English; translate it";
      case "english-left":
        return "part of it was left in English; translate every sentence";
      case "english-term":
        return `these concepts were left in English; use their translation: ${list}`;
      case "third-person":
        return "address the reader in the second person (tú) throughout";
    }
  });
}

export type TranslationGuardStats = {
  strings: number;
  kept: number;
  /** Calls made: the first, plus a retry for each round that had failures. */
  calls: number;
  /** Strings sent to a retry at least once. */
  retried: number;
  /** Failures of the first answer, by check. */
  counts: Partial<Record<TranslationCheck, number>>;
  /** Failures left after the last retry, by check (hard ones keep the English original). */
  remaining: Partial<Record<TranslationCheck, number>>;
  /** Strings shown in English after every retry failed. */
  fallbacks: number;
  /** Which string failed which check on which attempt; never the text. */
  failures: Array<{ path: string; check: TranslationCheck; attempt: number }>;
  terms: { total: number; names: number; concepts: number; forced: number; fallbacks: number };
  /** Names present in a source string, and how many came through verbatim. */
  protectedTerms: { present: number; preserved: number };
  /** Digit groups in the sources, and how many came through. */
  digits: { present: number; preserved: number };
};

/** Names and digits carried through, over the final strings. */
export function carriedThrough(sources: ProseMap, kept: ProseMap, names: readonly string[]) {
  const protectedTerms = { present: 0, preserved: 0 };
  const digits = { present: 0, preserved: 0 };
  for (const [path, source] of Object.entries(sources)) {
    const text = kept[path] ?? source;
    for (const name of names) {
      if (!tokenPattern(name).test(source)) continue;
      protectedTerms.present += 1;
      if (tokenPattern(name).test(text)) protectedTerms.preserved += 1;
    }
    const remaining = digitGroups(text);
    for (const group of digitGroups(source)) {
      digits.present += 1;
      const at = remaining.indexOf(group);
      if (at >= 0) {
        digits.preserved += 1;
        remaining.splice(at, 1);
      }
    }
  }
  return { protectedTerms, digits };
}
