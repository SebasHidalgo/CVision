import { describe, expect, it } from "vitest";
import { PdfNoTextError, PdfUnreadableError } from "@/lib/error/errors";
import { extractTextFromPDFFile } from "./pdfParse";

/** A one-page PDF whose page draws `content`. ASCII only, so length = bytes. */
function pdfBytes(content: string): Uint8Array<ArrayBuffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

const textPage = (text: string) => `BT /F1 12 Tf 72 712 Td (${text}) Tj ET`;

// What a scan is: a page that only paints an image. 2x2 gray inline image.
const imagePage = "q 200 0 0 200 72 500 cm BI /W 2 /H 2 /CS /G /BPC 8 ID AAAA EI Q";

const asFile = (bytes: Uint8Array<ArrayBuffer>) =>
  new File([bytes], "cv.pdf", { type: "application/pdf" });

async function rejectionOf(bytes: Uint8Array<ArrayBuffer>): Promise<unknown> {
  try {
    await extractTextFromPDFFile(asFile(bytes));
  } catch (error) {
    return error;
  }
  throw new Error("Expected extraction to fail");
}

describe("extractTextFromPDFFile", () => {
  it("returns the text layer of a readable PDF", async () => {
    const text = await extractTextFromPDFFile(
      asFile(pdfBytes(textPage("Jane Doe, Frontend Engineer"))),
    );

    expect(text).toBe("Jane Doe, Frontend Engineer");
  });

  it.each([
    ["a page with only an image, like a scan", imagePage],
    ["a blank page", ""],
    ["a page with only whitespace text", textPage("   ")],
  ])("throws PdfNoTextError (PDF_NO_TEXT) for %s", async (_, content) => {
    const error = await rejectionOf(pdfBytes(content));

    expect(error).toBeInstanceOf(PdfNoTextError);
    expect(error).toHaveProperty("code", "PDF_NO_TEXT");
  });

  it.each([
    ["bytes that are not a PDF", new TextEncoder().encode("plainly not a pdf")],
    ["a truncated PDF", pdfBytes(textPage("Jane Doe")).slice(0, 60)],
    ["an empty file", new Uint8Array()],
  ])("throws PdfUnreadableError (PDF_UNREADABLE) for %s", async (_, bytes) => {
    const error = await rejectionOf(bytes);

    expect(error).toBeInstanceOf(PdfUnreadableError);
    expect(error).toHaveProperty("code", "PDF_UNREADABLE");
  });
});
