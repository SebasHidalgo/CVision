import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLeaks, windowsOf, wordsOf } from "./realDataGuard";

const ROOT = path.resolve(__dirname, "../..");
const LOCAL = path.join(ROOT, "scripts/eval/fixtures.local");
const BINARY = /\.(pdf|png|jpe?g|gif|ico|woff2?|ttf|otf|webp|zip|wasm)$/i;

describe("realDataGuard", () => {
  it("compares words without accents, case, punctuation or spacing", () => {
    expect(wordsOf("  • Asociaci´on   Voluntarios, de Corazón.")).toEqual(["asociacion", "voluntarios", "de", "corazon"]);
    expect(windowsOf("one two three four five six seven")).toEqual(["one two three four five six", "two three four five six seven"]);
    expect(windowsOf("one two three four five")).toEqual([]);
  });

  it("finds six or more consecutive words inside a file, across a line break and a different accent, and nothing shorter", () => {
    const sources = [{ path: "x/cv.txt", text: "Full-Stack Developer, Asociaci´on Ejemplo Springfield\nPython, SQL and more" }];
    const files = [
      { path: "a.test.ts", text: 'const CV = `Full-Stack Developer, Asociación\n  Ejemplo Springfield`;' },
      { path: "b.ts", text: "Python, SQL and more" },
    ];
    expect(findLeaks(sources, files)).toEqual([{ file: "a.test.ts", source: "x/cv.txt", fragment: "full stack developer asociacion ejemplo springfield" }]);
  });
});

// The owner's real CVs and postings stay in fixtures.local/: no six consecutive words of them in a tracked file.
describe.skipIf(!existsSync(LOCAL))("tracked files", () => {
  it("share no run of six words with a fixtures.local cv.txt or job.txt", () => {
    const sources = readdirSync(LOCAL, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => ["cv.txt", "job.txt"].map((name) => path.join(LOCAL, entry.name, name)))
      .filter((file) => existsSync(file))
      .map((file) => ({ path: path.relative(LOCAL, file), text: readFileSync(file, "utf8") }));
    const files = execSync("git ls-files", { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\n")
      .filter((file) => file && !BINARY.test(file))
      .map((file) => path.join(ROOT, file))
      .filter((file) => existsSync(file) && statSync(file).size < 4_000_000)
      .map((file) => ({ path: path.relative(ROOT, file), text: readFileSync(file, "utf8") }));

    expect(sources.length).toBeGreaterThan(0);
    expect(findLeaks(sources, files).map((leak) => `${leak.file}: ${leak.fragment}`)).toEqual([]);
    // Reads every tracked file: about 4 s alone, past the 5 s default while the full suite runs.
  }, 60_000);
});
