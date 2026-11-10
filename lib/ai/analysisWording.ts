import type { Sentence } from "@/lib/ai/sentences";
import type { Locale } from "@/lib/i18n/config";
import { renderSentences } from "@/lib/i18n/sentences";

// The sentences code writes into an analysis are data (lib/ai/sentences.ts); this is the one place the pipeline renders them. Pure.

export type AnalysisLanguage = Locale;

/** A requirement whose note code wrote: the sentences, and their rendering for the pipeline's own checks. */
export type CodeNote = { note: string; noteSentences: Sentence[] };

export function codeNote(sentences: Sentence[], language: AnalysisLanguage = "en"): CodeNote {
  return { note: renderSentences(sentences, language), noteSentences: sentences };
}
