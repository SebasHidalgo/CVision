// Compiles cv.tex five ways and prints chromium.html, the corpus for accent composition. node scripts/eval/accents/build.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = process.env.TEX_BIN ?? "";
const tex = readFileSync(path.join(here, "cv.tex"), "utf8");

const VARIANTS = [
  { name: "pdflatex-ot1", engine: "pdflatex", preamble: "" },
  { name: "pdflatex-ot1-gentounicode", engine: "pdflatex", preamble: "\\input{glyphtounicode}\n\\pdfgentounicode=1" },
  { name: "pdflatex-t1", engine: "pdflatex", preamble: "\\usepackage[T1]{fontenc}" },
  { name: "xelatex", engine: "xelatex", preamble: "\\usepackage{fontspec}" },
  { name: "lualatex", engine: "lualatex", preamble: "\\usepackage{fontspec}" },
];

for (const variant of VARIANTS) {
  const dir = mkdtempSync(path.join(tmpdir(), "accents-"));
  writeFileSync(path.join(dir, "cv.tex"), tex.replace("%PREAMBLE%", variant.preamble));
  execFileSync(path.join(bin, variant.engine), ["-interaction=nonstopmode", "-halt-on-error", "cv.tex"], { cwd: dir, stdio: "ignore" });
  copyFileSync(path.join(dir, "cv.pdf"), path.join(here, `${variant.name}.pdf`));
  rmSync(dir, { recursive: true, force: true });
  console.log(`${variant.name}.pdf`);
}

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file:///${path.join(here, "chromium.html").replace(/\\/g, "/")}`);
await page.pdf({ path: path.join(here, "chromium.pdf"), format: "Letter" });
await browser.close();
console.log("chromium.pdf");
