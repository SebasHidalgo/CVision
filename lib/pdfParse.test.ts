import { describe, expect, it } from "vitest";
import { PdfNoTextError, PdfUnreadableError } from "@/lib/error/errors";
import { extractTextFromPDFFile, MIN_PDF_TEXT_CHARS } from "./pdfParse";

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

/**
 * Draws `text` wrapped at spaces into lines that fit the page: pdf.js drops
 * glyphs placed past the page edge, so one long line would lose its tail.
 */
function textPage(text: string): string {
  const lines: string[] = [];
  // Explicit line breaks are kept; anything longer than the page is wrapped.
  for (const source of text.split("\n")) {
    lines.push("");
    for (const word of source.split(" ")) {
      const last = lines.length - 1;
      if (lines[last] === "") lines[last] = word;
      else if (lines[last].length + word.length < 70) lines[last] += ` ${word}`;
      else lines.push(word);
    }
  }
  const shown = lines.map((line) => `(${line}) Tj`).join(" T* ");
  return `BT /F1 10 Tf 12 TL 72 740 Td ${shown} ET`;
}

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

// A deliberately thin CV (341 non-whitespace characters) still clears it.
const CV_TEXT =
  "Jane Doe Frontend Engineer. Experience: Northwind, Frontend Engineer, " +
  "2021 to present. Led the checkout rewrite in React and TypeScript, cut " +
  "page load time by 40 percent and mentored four engineers. Contoso, " +
  "Junior Developer, 2018 to 2021. Built design system components used by " +
  "six product teams. Skills: React, TypeScript, Next.js, testing, " +
  "accessibility. Education: BSc Computer Science, 2018.";

/** `count` non-whitespace characters, each followed by a space. */
const spaced = (count: number) => Array(count).fill("x").join(" ");

/** The words, ignoring where the lines fall. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

describe("extractTextFromPDFFile", () => {
  it("returns the text layer of a readable PDF", async () => {
    const text = await extractTextFromPDFFile(asFile(pdfBytes(textPage(CV_TEXT))));

    // `textPage` wraps the source into page lines, and extraction now gives
    // those lines back, so the comparison is on the words.
    expect(flat(text)).toBe(CV_TEXT);
  });

  it("gives back the lines of the page, not one run of text", async () => {
    const page = ["EXPERIENCE", "- Shipped the checkout rewrite.", "- Mentored two engineers."];
    const text = await extractTextFromPDFFile(
      asFile(pdfBytes(textPage([CV_TEXT, ...page].join("\n")))),
    );

    expect(text.split("\n")).toEqual(expect.arrayContaining(page));
  });

  it.each([
    ["a page with only an image, like a scan", imagePage],
    ["a scan carrying a scanner watermark", textPage("Scanned with CamScanner")],
    ["a scan with only OCR'd page numbers", textPage("1 2 3 4")],
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

describe("extractTextFromPDFFile: text threshold", () => {
  it(`accepts exactly ${MIN_PDF_TEXT_CHARS} non-whitespace characters`, async () => {
    const text = spaced(MIN_PDF_TEXT_CHARS);

    // Compared flat: the page wraps this into lines, which extraction keeps.
    const extracted = await extractTextFromPDFFile(asFile(pdfBytes(textPage(text))));

    expect(flat(extracted)).toBe(text);
  });

  it(`rejects ${MIN_PDF_TEXT_CHARS - 1}, however much whitespace pads them`, async () => {
    // Almost twice the threshold in total length: only non-whitespace counts.
    const error = await rejectionOf(pdfBytes(textPage(spaced(MIN_PDF_TEXT_CHARS - 1))));

    expect(error).toBeInstanceOf(PdfNoTextError);
  });
});
