import { extractText } from "unpdf";

export async function extractTextFromPDFFile(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();

    const { text } = await extractText(new Uint8Array(arrayBuffer), {
      mergePages: true,
    });

    return text;
  } catch (error) {
    throw new Error(
      `Failed to extract text from PDF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
