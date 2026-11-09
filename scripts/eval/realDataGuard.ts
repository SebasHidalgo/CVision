// The owner's real CVs and postings live in fixtures.local/ and must never reach a tracked file.

/** Consecutive words a tracked file may share with a real CV or posting. */
export const WINDOW_WORDS = 6;

// Combining accents, and the spacing ones a LaTeX text layer leaves ("Asociaci´on").
const ACCENTS = /[̀-ͯ´`¨¸ˆˇ˘-˝^~]/g;

/** Lowercase words, accents and punctuation gone: "Asociaci´on" and "Asociación" read the same. */
export function wordsOf(text: string): string[] {
  return text.normalize("NFD").replace(ACCENTS, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Every run of WINDOW_WORDS consecutive words in a text. */
export function windowsOf(text: string): string[] {
  const words = wordsOf(text);
  const windows: string[] = [];
  for (let i = 0; i + WINDOW_WORDS <= words.length; i += 1) windows.push(words.slice(i, i + WINDOW_WORDS).join(" "));
  return windows;
}

export type Leak = { file: string; source: string; fragment: string };

/** Each stretch of a tracked file that shares WINDOW_WORDS or more consecutive words with a real source. */
export function findLeaks(sources: { path: string; text: string }[], files: { path: string; text: string }[]): Leak[] {
  const guarded = new Map<string, string>();
  for (const source of sources) for (const window of windowsOf(source.text)) if (!guarded.has(window)) guarded.set(window, source.path);
  const leaks: Leak[] = [];
  for (const file of files) {
    const words = wordsOf(file.text);
    let i = 0;
    while (i + WINDOW_WORDS <= words.length) {
      const source = guarded.get(words.slice(i, i + WINDOW_WORDS).join(" "));
      if (!source) {
        i += 1;
        continue;
      }
      // Extend over every following window that also matches: one leak per stretch.
      let end = i + WINDOW_WORDS;
      while (end < words.length && guarded.has(words.slice(end - WINDOW_WORDS + 1, end + 1).join(" "))) end += 1;
      leaks.push({ file: file.path, source, fragment: words.slice(i, end).join(" ") });
      i = end;
    }
  }
  return leaks;
}
