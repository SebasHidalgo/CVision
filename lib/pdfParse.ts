import { extractText } from "unpdf";
import { PdfNoTextError, PdfUnreadableError } from "@/lib/error/errors";

/**
 * Fewer non-whitespace characters than this is read as "no text layer": scanner
 * watermarks ("Scanned with CamScanner") and OCR'd page numbers stay far below
 * it, and any real CV is far above it.
 */
export const MIN_PDF_TEXT_CHARS = 200;

/**
 * The PDF's text layer, whitespace-collapsed. Throws `PdfUnreadableError` when
 * the file can't be opened and `PdfNoTextError` when it opens but holds too
 * little text to be a CV, as with a scan.
 */
export async function extractTextFromPDFFile(file: File): Promise<string> {
  let text: string;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    ({ text } = await extractText(bytes, { mergePages: true }));
  } catch (error) {
    throw new PdfUnreadableError(
      `PDF could not be parsed: ${
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"
      }`,
    );
  }

  // Without text the model would invent feedback for a CV it never read.
  const textChars = text.replace(/\s/g, "").length;
  if (textChars < MIN_PDF_TEXT_CHARS) {
    // The count is safe to log and is what a threshold change would be tuned on.
    throw new PdfNoTextError(`PDF text layer has ${textChars} non-whitespace characters`);
  }

  return text;
}
