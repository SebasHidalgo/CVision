import { extractText } from "unpdf";
import { PdfNoTextError, PdfUnreadableError } from "@/lib/error/errors";

/**
 * The PDF's text layer, whitespace-collapsed. Throws `PdfUnreadableError` when
 * the file can't be opened and `PdfNoTextError` when it opens but holds no
 * text, as with a scan.
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
  if (!text.trim()) throw new PdfNoTextError();

  return text;
}
