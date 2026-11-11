import type { i18n as I18n } from "i18next";
import type { Phrase, Sentence } from "@/lib/ai/sentences";
import enSentences from "@/locales/en/sentences.json";
import esSentences from "@/locales/es/sentences.json";
import { INTL_LOCALE, type Locale } from "./config";
import { createI18n } from "./instance";

/**
 * Renders the code-made sentences of an analysis (lib/ai/sentences.ts) in a language. Pure: one
 * instance per locale, created on first use and never changed after (no changeLanguage, no added
 * resources), so sharing it across requests shares nothing that varies.
 */

const TEMPLATES = { en: enSentences, es: esSentences } as const;
const instances = new Map<Locale, I18n>();

function instance(locale: Locale): I18n {
  let found = instances.get(locale);
  if (!found) {
    found = createI18n(locale, { sentences: TEMPLATES[locale] });
    instances.set(locale, found);
  }
  return found;
}

const conjunction = (locale: Locale, join: "and" | "or", next: string): string => {
  const word = TEMPLATES[locale].conj[join];
  if (locale !== "es") return word;
  // Spanish: "y" is "e" before an i sound, "o" is "u" before an o sound.
  if (join === "and" && /^h?[iíIÍ](?![aeouáéóú])/u.test(next)) return "e";
  if (join === "or" && /^h?[oóOÓ]/u.test(next)) return "u";
  return word;
};

const formatNumber = (value: number, locale: Locale) =>
  new Intl.NumberFormat(INTL_LOCALE[locale], { useGrouping: false, maximumFractionDigits: 1 }).format(value);

export function renderPhrase(phrase: Phrase, locale: Locale): string {
  if (typeof phrase === "string") return phrase;
  if ("quote" in phrase) return `"${phrase.quote}"`;
  if ("number" in phrase) return formatNumber(phrase.number, locale);
  if ("language" in phrase) {
    const names = TEMPLATES[locale].languages as Record<string, string>;
    return names[phrase.language] ?? phrase.language;
  }
  if ("stop" in phrase) {
    const text = renderPhrase(phrase.stop, locale);
    return text.endsWith("…") ? text : `${text}.`;
  }
  if ("msg" in phrase) return renderSentence(phrase.msg, locale);
  const items = phrase.list.map((item) => renderPhrase(item, locale));
  if (phrase.join === "semicolon") return items.join("; ");
  if (phrase.chain) return items.reduce((text, item, i) => (i === 0 ? item : `${text} ${conjunction(locale, phrase.join as "and" | "or", item)} ${item}`), "");
  // "A, B and C": the same shape the guardrails always wrote.
  if (items.length <= 1) return items[0] ?? "";
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(", ")} ${conjunction(locale, phrase.join, last)} ${last}`;
}

export function renderSentence(sentence: Sentence, locale: Locale): string {
  const i18n = instance(locale);
  // A key this build does not know (a row from a newer one) renders as nothing rather than as its name.
  if (!i18n.exists(sentence.key, { ns: "sentences", ...(sentence.count !== undefined ? { count: sentence.count } : {}) })) return "";
  const values = Object.fromEntries(Object.entries(sentence.params ?? {}).map(([name, phrase]) => [name, renderPhrase(phrase, locale)]));
  return i18n.t(sentence.key, {
    ns: "sentences",
    ...values,
    ...(sentence.count !== undefined ? { count: sentence.count } : {}),
    ...(sentence.context ? { context: sentence.context } : {}),
  } as never) as unknown as string;
}

/** Several sentences as one paragraph, the way the analysis always joined them. */
export function renderSentences(sentences: readonly Sentence[], locale: Locale): string {
  return sentences.map((sentence) => renderSentence(sentence, locale)).filter(Boolean).join(" ");
}
