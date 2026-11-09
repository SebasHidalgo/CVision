import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLeaks, guardedLines, normalizeLine } from "./realDataGuard";

const ROOT = path.resolve(__dirname, "../..");
const LOCAL = path.join(ROOT, "scripts/eval/fixtures.local");
const BINARY = /\.(pdf|png|jpe?g|gif|ico|woff2?|ttf|otf|webp|zip|wasm)$/i;

describe("realDataGuard", () => {
  it("compares lines without list markers, closing punctuation or spacing differences", () => {
    expect(normalizeLine("  • Led   the migration of the billing service.  ")).toBe("Led the migration of the billing service");
    expect(guardedLines("Short line\n* Led the migration of the billing service;\nLed the migration of the billing service")).toEqual([
      "Led the migration of the billing service",
    ]);
  });

  it("finds a guarded line inside a file, across a line break, and nothing shorter", () => {
    const sources = [{ path: "x/cv.txt", text: "Led the migration of the billing service\nPython, SQL" }];
    const files = [
      { path: "a.test.ts", text: 'const CV = `Led the migration of the\n  billing service`;' },
      { path: "b.ts", text: "Python, SQL" },
    ];
    expect(findLeaks(sources, files)).toEqual([{ file: "a.test.ts", source: "x/cv.txt", line: "Led the migration of the billing service" }]);
  });
});

// The owner's real CVs and postings stay in fixtures.local/: no line of them in a tracked file.
describe.skipIf(!existsSync(LOCAL))("tracked files", () => {
  it("contain no line of 25+ characters from a fixtures.local cv.txt or job.txt", () => {
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
    expect(findLeaks(sources, files).map((leak) => `${leak.file}: ${leak.line}`)).toEqual([]);
  });
});
