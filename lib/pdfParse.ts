import { getDocumentProxy } from "unpdf";
import { PdfNoTextError, PdfUnreadableError } from "@/lib/error/errors";

/**
 * Fewer non-whitespace characters than this is read as "no text layer": scanner
 * watermarks ("Scanned with CamScanner") and OCR'd page numbers stay far below
 * it, and any real CV is far above it.
 */
export const MIN_PDF_TEXT_CHARS = 200;

/**
 * A vertical gap this many times the page's usual line spacing reads as a
 * section break rather than the next line.
 */
const PARAGRAPH_GAP_RATIO = 1.6;

/** The pdf.js text items we use; marked-content entries carry no `str`. */
type TextItem = { str: string; hasEOL: boolean; transform: number[] };

type Line = { text: string; y: number };

const isTextItem = (item: unknown): item is TextItem =>
  typeof (item as TextItem)?.str === "string";

/**
 * The PDF's text as a document: one line per line of the page, blank lines at
 * section breaks, pages separated by a blank line. Throws `PdfUnreadableError`
 * when the file can't be opened and `PdfNoTextError` when it opens but holds
 * too little text to be a CV, as with a scan.
 *
 * Line structure matters as much as the words: the analysis judges section
 * headings, bullet boundaries and readability, none of which survive a flat
 * run of text.
 */
export async function extractTextFromPDFFile(file: File): Promise<string> {
  let text: string;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    text = await readDocument(bytes);
  } catch (error) {
    throw new PdfUnreadableError(
      `PDF could not be parsed: ${
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"
      }`,
    );
  }

  const textChars = text.replace(/\s/g, "").length;
  if (textChars < MIN_PDF_TEXT_CHARS) {
    // The count is safe to log and is what a threshold change would be tuned on.
    throw new PdfNoTextError(`PDF text layer has ${textChars} non-whitespace characters`);
  }

  return text;
}

async function readDocument(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);

  try {
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent();
      pages.push(withSectionBreaks(linesOf(items)));
    }

    return pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await pdf.destroy();
  }
}

/**
 * Items joined into lines, broken where pdf.js reports the end of a line.
 * Joined with no separator, exactly as the text layer stores them: a glyph
 * split across two items — how LaTeX writes an accent, `Jos` + `´` + `e` —
 * must come back out as it went in, because that artifact is what an ATS sees.
 */
function linesOf(items: unknown[]): Line[] {
  const lines: Line[] = [];
  let parts: string[] = [];
  let y: number | null = null;

  const flush = () => {
    const text = parts.join("").replace(/[ \t]+/g, " ").trim();
    if (text) lines.push({ text, y: y ?? 0 });
    parts = [];
    y = null;
  };

  for (const item of items) {
    if (!isTextItem(item)) continue;
    if (item.str !== "") {
      parts.push(item.str);
      y ??= item.transform[5];
    }
    if (item.hasEOL) flush();
  }
  flush();

  return lines;
}

/** Blank line wherever the page leaves more vertical space than usual. */
function withSectionBreaks(lines: Line[]): string {
  const gaps = lines
    .slice(1)
    .map((line, i) => lines[i].y - line.y)
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);
  const usual = gaps[Math.floor(gaps.length / 2)] ?? 0;

  return lines
    .map((line, i) => {
      const gap = i > 0 ? lines[i - 1].y - line.y : 0;
      const isBreak = usual > 0 && gap > usual * PARAGRAPH_GAP_RATIO;
      return `${isBreak ? "\n" : ""}${line.text}`;
    })
    .join("\n");
}
