// The owner's real CVs and postings live in fixtures.local/ and must never reach a tracked file.

export const MIN_GUARDED_LINE = 25;

/** A line as compared: whitespace collapsed, list marker and closing punctuation dropped. */
export function normalizeLine(line: string): string {
  return line
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[•*·\-–—]+\s*/, "")
    .replace(/[\s.;:,]+$/, "");
}

/** The guarded lines of one real CV or posting. */
export function guardedLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map(normalizeLine).filter((line) => line.length >= MIN_GUARDED_LINE);
  return [...new Set(lines)];
}

export type Leak = { file: string; source: string; line: string };

/** Every guarded line that appears inside a tracked file, whitespace-insensitive. */
export function findLeaks(sources: { path: string; text: string }[], files: { path: string; text: string }[]): Leak[] {
  const guarded = sources.flatMap((source) => guardedLines(source.text).map((line) => ({ source: source.path, line })));
  const leaks: Leak[] = [];
  for (const file of files) {
    const flat = file.text.replace(/\s+/g, " ");
    for (const { source, line } of guarded) {
      if (flat.includes(line)) leaks.push({ file: file.path, source, line });
    }
  }
  return leaks;
}
