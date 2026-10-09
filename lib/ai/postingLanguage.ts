/** Languages the voice agent is configured for. Default is English. */
export const INTERVIEW_LANGUAGES = ["en", "es"] as const;
export type InterviewLanguage = (typeof INTERVIEW_LANGUAGES)[number];

export const INTERVIEW_LANGUAGE_NAMES: Record<InterviewLanguage, string> = {
  en: "English",
  es: "Spanish",
};

// Enough text to count function words; a posting's language is settled long
// before this.
const SAMPLE_CHARS = 600;

// Function words only: content words like "developer" or "React" appear in
// postings of both languages. Words shared by both ("a", "no", "me") are left
// out of both lists on purpose.
const SPANISH_WORDS = [
  "el", "la", "los", "las", "de", "del", "que", "y", "con", "para", "por",
  "una", "un", "en", "es", "se", "al", "como", "más", "nuestro", "nuestra",
  "experiencia", "años", "conocimientos", "requisitos", "habilidades",
  "buscamos", "puesto", "empresa", "equipo", "trabajo", "funciones",
];

const ENGLISH_WORDS = [
  "the", "and", "with", "for", "of", "to", "you", "our", "we", "is", "are",
  "in", "an", "as", "or", "this", "will", "experience", "years", "skills",
  "requirements", "team", "role", "work", "ability", "strong",
];

// Characters that only Spanish uses among the languages this is likely to see.
const SPANISH_ONLY_CHARS = /[ñ¿¡]/g;
// Accented vowels: Spanish evidence, though Portuguese and French share them.
const ACCENTED_VOWELS = /[áéíóúü]/g;

function countWords(sample: string, words: readonly string[]): number {
  let hits = 0;
  for (const word of words) {
    const matches = sample.match(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "gu"));
    hits += matches?.length ?? 0;
  }
  return hits;
}

/**
 * Which language the agent should transcribe and speak for this posting.
 * A function-word tally on the first few hundred characters, not a language
 * detector: it separates English from Spanish, which is what the users here
 * meet (English postings from Costa Rica, some Spanish ones).
 *
 * Known limits, by design: a bilingual posting is scored by whichever half
 * comes first; Portuguese, Italian or French read as Spanish when they share
 * enough function words; a posting that is mostly a bullet list of tool names
 * with few function words falls back to English. English wins ties, which is
 * the configured default.
 */
export function detectPostingLanguage(text: string): InterviewLanguage {
  const sample = text.slice(0, SAMPLE_CHARS).toLowerCase();

  const spanish =
    countWords(sample, SPANISH_WORDS) +
    2 * (sample.match(SPANISH_ONLY_CHARS)?.length ?? 0) +
    (sample.match(ACCENTED_VOWELS)?.length ?? 0);
  const english = countWords(sample, ENGLISH_WORDS);

  return spanish > english ? "es" : "en";
}
