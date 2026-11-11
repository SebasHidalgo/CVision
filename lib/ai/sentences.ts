import { z } from "zod";

/**
 * The sentences code writes into an analysis, stored as data and rendered per language at display
 * time (lib/i18n/sentences.ts, templates in locales/<locale>/sentences.json). A result never changes
 * with the language: only the words around the verbatim parts do. Import-light: zod only.
 */

/** A piece of a sentence. Strings are verbatim (posting, CV or key-term words) and never translated. */
export type Phrase =
  | string
  /** "A, B or C" (series) or "A and B and C" (chain), with the language's conjunction; "; " for semicolon. */
  | { list: Phrase[]; join: "and" | "or" | "semicolon"; chain?: boolean }
  /** A CV word in quotation marks. */
  | { quote: string }
  /** A figure, formatted for the language (2.5 / 2,5). */
  | { number: number }
  /** A language name from the code's own table ("English"), translated when the locale names it. */
  | { language: string }
  /** The phrase closed with a full stop, unless it ends cut with "…". */
  | { stop: Phrase }
  /** A nested sentence used as a phrase ("3+ years of experience"). */
  | { msg: Sentence };

export type Sentence = {
  key: SentenceKey;
  params?: Record<string, Phrase>;
  /** Picks the plural form. */
  count?: number;
  /** Picks a variant: "several" for plural subjects, "met". */
  context?: "several" | "met";
};

export const SENTENCE_KEYS = [
  "downgrade",
  "shownButNot",
  "noneOf",
  "notShown",
  "years",
  "yearsTotal",
  "alternative",
  "contextOnly",
  "languageLevel",
  "coreGaps",
  "partlyMet",
  "allMet",
  "noGapsNotShown",
  "yearsLabel",
  "showsOne",
  "showsOf",
  "moreInList",
  "forInterview",
  "preferredNotShown",
  "notShownAsAsked",
  "relatedOnly",
] as const;
export type SentenceKey = (typeof SENTENCE_KEYS)[number];

const phraseSchema: z.ZodType<Phrase> = z.lazy(() =>
  z.union([
    z.string(),
    z.object({ list: z.array(phraseSchema), join: z.enum(["and", "or", "semicolon"]), chain: z.boolean().optional() }),
    z.object({ quote: z.string() }),
    z.object({ number: z.number() }),
    z.object({ language: z.string() }),
    z.object({ stop: phraseSchema }),
    z.object({ msg: sentenceSchema }),
  ]),
);

// The key is a string on read: a row written by a newer build must not invalidate the whole analysis.
export const sentenceSchema: z.ZodType<Sentence> = z.lazy(() =>
  z.object({
    key: z.string() as z.ZodType<SentenceKey>,
    params: z.record(z.string(), phraseSchema).optional(),
    count: z.number().optional(),
    context: z.enum(["several", "met"]).optional(),
  }),
);

export const sentencesSchema = z.array(sentenceSchema);

// Builders: what each code-made sentence takes.
export const and = (items: Phrase[]): Phrase => ({ list: items, join: "and" });
export const or = (items: Phrase[]): Phrase => ({ list: items, join: "or" });
/** "A and B and C": languages, and the shown terms of a gap sentence. */
export const chain = (items: Phrase[]): Phrase => ({ list: items, join: "and", chain: true });
export const semicolons = (items: Phrase[]): Phrase => ({ list: items, join: "semicolon" });

export const say = {
  downgrade: (): Sentence => ({ key: "downgrade" }),
  shownButNot: (shown: Phrase, absent: Phrase): Sentence => ({ key: "shownButNot", params: { shown, absent } }),
  noneOf: (absent: Phrase): Sentence => ({ key: "noneOf", params: { absent } }),
  notShown: (absent: Phrase): Sentence => ({ key: "notShown", params: { absent } }),
  years: (min: number, value: number): Sentence => ({ key: "years", params: { min: { number: min }, value: { number: value } } }),
  yearsTotal: (min: number, value: number): Sentence => ({ key: "yearsTotal", params: { min: { number: min }, value: { number: value } } }),
  alternative: (absent: Phrase, several: boolean, accepts: string): Sentence => ({
    key: "alternative",
    params: { absent, accepts },
    ...(several ? { context: "several" as const } : {}),
  }),
  contextOnly: (shown: Phrase, several: boolean): Sentence => ({ key: "contextOnly", params: { shown }, ...(several ? { context: "several" as const } : {}) }),
  languageLevel: (languages: string[]): Sentence => ({ key: "languageLevel", params: { language: chain(languages.map((language) => ({ language }))) } }),
  coreGaps: (labels: Phrase[]): Sentence => ({ key: "coreGaps", params: { list: { stop: semicolons(labels) } } }),
  partlyMet: (labels: Phrase[]): Sentence => ({ key: "partlyMet", params: { list: { stop: semicolons(labels) } } }),
  allMet: (): Sentence => ({ key: "allMet" }),
  noGapsNotShown: (count: number): Sentence => ({ key: "noGapsNotShown", count }),
  yearsLabel: (min: number): Phrase => ({ msg: { key: "yearsLabel", params: { min: { number: min } } } }),
  showsOf: (met: number, total: number): Sentence =>
    total === 1
      ? { key: "showsOne", ...(met ? { context: "met" as const } : {}) }
      : { key: "showsOf", params: { met: { number: met }, total: { number: total } } },
  moreInList: (count: number): Sentence => ({ key: "moreInList", count }),
  forInterview: (count: number): Sentence => ({ key: "forInterview", count }),
  preferredNotShown: (labels: Phrase[]): Sentence => ({ key: "preferredNotShown", params: { list: { stop: semicolons(labels) } } }),
  notShownAsAsked: (label: Phrase): Sentence => ({ key: "notShownAsAsked", params: { label: { stop: label } } }),
  relatedOnly: (shown: string[]): Sentence => ({
    key: "relatedOnly",
    params: { shown: and(shown.map((quote) => ({ quote }))) },
    ...(shown.length > 1 ? { context: "several" as const } : {}),
  }),
};
