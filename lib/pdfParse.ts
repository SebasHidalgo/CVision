import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { PdfNoTextError, PdfScannedError, PdfUnreadableError } from "@/lib/error/errors";
import { accentJoins, composeSplitAccents, type TextOps, withoutSpuriousSpaces } from "@/lib/pdfAccents";

/**
 * Fewer non-whitespace characters than this is read as "no text layer": scanner
 * watermarks ("Scanned with CamScanner") and OCR'd page numbers stay far below
 * it, and any real CV is far above it.
 */
export const MIN_PDF_TEXT_CHARS = 200;

/** A page that paints an image and holds fewer characters than this is a scanned page; a scanner watermark fits under it. */
export const MAX_SCANNED_PAGE_TEXT_CHARS = 40;

/**
 * A vertical gap this many times the page's usual line spacing reads as a
 * section break rather than the next line.
 */
const PARAGRAPH_GAP_RATIO = 1.6;

/**
 * The PDF specification lets up to this many bytes precede the `%PDF-`
 * header, and pdf.js reads such files. A stricter check would refuse files
 * the parser accepts.
 */
const PDF_HEADER_WINDOW_BYTES = 1024;
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** Whether the bytes begin as a PDF does, before any parsing is paid for. */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, PDF_HEADER_WINDOW_BYTES + PDF_HEADER.length) - PDF_HEADER.length;
  for (let at = 0; at <= limit; at += 1) {
    if (PDF_HEADER.every((byte, i) => bytes[at + i] === byte)) return true;
  }
  return false;
}

/** The pdf.js text items we use; marked-content entries carry no `str`. */
type TextItem = { str: string; hasEOL: boolean; transform: number[]; width: number; height: number };

/** The text and how many split accents were put back on their letters (a count only: it is logged). */
export type ExtractedPdfText = { text: string; accentsComposed: number };

type Line = { text: string; y: number };

const isTextItem = (item: unknown): item is TextItem =>
  typeof (item as TextItem)?.str === "string";

/** `extractTextFromPDFBytes` for a `File`, as the tests build them. */
export async function extractTextFromPDFFile(file: File): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new PdfUnreadableError(
      `PDF could not be read: ${error instanceof Error ? error.name : "unknown error"}`,
    );
  }
  return extractTextFromPDFBytes(bytes);
}

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
export async function extractTextFromPDFBytes(bytes: Uint8Array): Promise<string> {
  return (await extractPdfText(bytes)).text;
}

/** `extractTextFromPDFBytes` with the count of split accents it composed ("Jos´e" → "José"). */
export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdfText> {
  let document: { text: string; scannedPages: number; accentsComposed: number };

  try {
    document = await readDocument(bytes);
  } catch (error) {
    throw new PdfUnreadableError(
      `PDF could not be parsed: ${
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"
      }`,
    );
  }

  const { text, scannedPages, accentsComposed } = document;
  const textChars = nonBlank(text);
  if (textChars < MIN_PDF_TEXT_CHARS) {
    // Counts are safe to log and are what a threshold change would be tuned on.
    if (scannedPages > 0) {
      throw new PdfScannedError(`PDF text layer has ${textChars} non-whitespace characters and ${scannedPages} scanned page(s)`);
    }
    throw new PdfNoTextError(`PDF text layer has ${textChars} non-whitespace characters`);
  }

  return { text, accentsComposed };
}

const nonBlank = (text: string) => text.replace(/\s/g, "").length;

async function readDocument(bytes: Uint8Array): Promise<{ text: string; scannedPages: number; accentsComposed: number }> {
  // pdf.js transfers the buffer it is given: a copy leaves the caller's bytes intact.
  const pdf = await getDocumentProxy(bytes.slice());

  try {
    const pages: string[] = [];
    let accentsComposed = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent();
      const { items: composed, compositions } = composeSplitAccents((items as unknown[]).filter(isTextItem));
      accentsComposed += compositions.length;
      let pageItems = composed;
      // Only a space before a composed accent needs the glyph positions: "GESTI ÓN" or "Informatique, Être".
      if (compositions.some((composition) => composition.spaceBefore)) {
        const { OPS } = await getResolvedPDFJS();
        const { fnArray, argsArray } = await page.getOperatorList();
        pageItems = withoutSpuriousSpaces(composed, compositions, accentJoins(fnArray, argsArray, OPS as TextOps)).items;
      }
      pages.push(withSectionBreaks(linesOf(pageItems)));
    }

    const text = pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    // Operator lists only on the refusal path: a real CV never pays for them.
    if (nonBlank(text) >= MIN_PDF_TEXT_CHARS) return { text, scannedPages: 0, accentsComposed };

    const { OPS } = await getResolvedPDFJS();
    const paintsImage = new Set([
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageXObjectRepeat,
      OPS.paintInlineImageXObjectGroup,
      OPS.paintImageMaskXObject,
      OPS.paintImageMaskXObjectGroup,
      OPS.paintImageMaskXObjectRepeat,
    ]);
    let scannedPages = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      if (nonBlank(pages[number - 1]) >= MAX_SCANNED_PAGE_TEXT_CHARS) continue;
      const { fnArray } = await (await pdf.getPage(number)).getOperatorList();
      if (fnArray.some((op) => paintsImage.has(op))) scannedPages += 1;
    }
    return { text, scannedPages, accentsComposed };
  } finally {
    await pdf.destroy();
  }
}

/**
 * Items joined into lines, broken where pdf.js reports the end of a line, with
 * no separator: a word split across items comes back whole. Split accents were
 * already composed (lib/pdfAccents.ts).
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
