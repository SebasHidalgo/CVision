/**
 * Renders each fixture's cv.html to cv.pdf with Chromium, then writes cv.txt
 * from the PDF's text layer through the production parser, so the text arm
 * reads exactly what the app would extract. A fixture whose fixture.json says
 * `pdf.scanned` is rendered to a page image first and the PDF holds only the
 * image: no text layer, which the parser must refuse. Its cv.txt is the
 * document's true text, taken from the HTML.
 *
 *   npm run eval:pdf              every fixture with a cv.html
 *   npm run eval:pdf -- <id> ...  only those
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { AppError } from "@/lib/error/errors";
import { extractTextFromPDFBytes } from "@/lib/pdfParse";

const FIXTURES = path.join(__dirname, "fixtures");

// A4 at 96 dpi; the scan is captured at twice that so the model can read it.
const SCAN_VIEWPORT = { width: 794, height: 1123 };

type Meta = { pdf?: { scanned?: boolean; layout?: string } };

async function renderPdf(page: Page, html: string): Promise<Buffer> {
  await page.setContent(html, { waitUntil: "load" });
  return page.pdf({ preferCSSPageSize: true, printBackground: true });
}

async function renderScan(page: Page, html: string): Promise<Buffer> {
  await page.setContent(html, { waitUntil: "load" });
  const png = await page.screenshot({ fullPage: true, type: "png" });
  const image = `data:image/png;base64,${png.toString("base64")}`;
  const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}html,body{margin:0}img{width:210mm;display:block}</style></head><body><img src="${image}"></body></html>`;
  await page.setContent(sheet, { waitUntil: "load" });
  return page.pdf({ preferCSSPageSize: true, printBackground: true });
}

const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const names = (await readdir(FIXTURES, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .filter((name) => existsSync(path.join(FIXTURES, name, "cv.html")))
    .filter((name) => only.length === 0 || only.includes(name));
  if (names.length === 0) {
    console.error("No fixture with a cv.html matched.");
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch();
  try {
    for (const name of names) {
      const dir = path.join(FIXTURES, name);
      const meta = JSON.parse(await readFile(path.join(dir, "fixture.json"), "utf8")) as Meta;
      const html = await readFile(path.join(dir, "cv.html"), "utf8");
      const scanned = meta.pdf?.scanned === true;
      const page = await browser.newPage({ viewport: SCAN_VIEWPORT, deviceScaleFactor: 2 });

      await page.setContent(html, { waitUntil: "load" });
      const trueText = (await page.evaluate(() => document.body.innerText)).replace(/\n{3,}/g, "\n\n").trim();
      const pdf = scanned ? await renderScan(page, html) : await renderPdf(page, html);
      await page.close();
      await writeFile(path.join(dir, "cv.pdf"), pdf);

      let note: string;
      if (scanned) {
        await writeFile(path.join(dir, "cv.txt"), `${trueText}\n`);
        try {
          await extractTextFromPDFBytes(new Uint8Array(pdf));
          note = "!! the parser accepted the scan: it has a text layer after all";
          process.exitCode = 1;
        } catch (error) {
          note = `parser refuses it: ${error instanceof AppError ? error.code : String(error)}; cv.txt from the HTML (${trueText.length} chars)`;
        }
      } else {
        const text = await extractTextFromPDFBytes(new Uint8Array(pdf));
        await writeFile(path.join(dir, "cv.txt"), `${text}\n`);
        note = `cv.txt from the text layer (${text.length} chars, ${text.split("\n").length} lines)`;
      }
      console.log(`  ${name.padEnd(26)} ${meta.pdf?.layout ?? "?"}${scanned ? ", scanned" : ""}: ${pageCount(pdf)} page(s), ${pdf.length} bytes; ${note}`);
    }
  } finally {
    await browser.close();
  }
}

// The script smoke test loads this module to prove its import graph; it must not render.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
