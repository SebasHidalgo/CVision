import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One design, no dark mode. Tailwind's default `dark:` variant follows the
 * OS setting, so a `dark:` class (shadcn's generated components ship them)
 * would restyle part of a page for anyone whose system is dark.
 */

const ROOT = path.resolve(__dirname, "..");
const SCOPES = ["app", "components", "screens", "hooks", "lib"];
const RULES: [string, RegExp][] = [
  ["a dark: class", /(?<![\w-])dark:[\w[!-]/],
  ["next-themes", /next-themes/],
  ["a prefers-color-scheme query", /prefers-color-scheme/],
  ["a dark variant", /@custom-variant\s+dark/],
];

function* files(target: string): Generator<string> {
  for (const name of readdirSync(target)) {
    const child = path.join(target, name);
    if (statSync(child).isDirectory()) yield* files(child);
    else if (/\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield child;
  }
}

describe("one design", () => {
  it("no source styles a dark mode or reads the system's color scheme", () => {
    const offenders: string[] = [];
    for (const scope of SCOPES) {
      for (const file of files(path.join(ROOT, scope))) {
        const text = readFileSync(file, "utf8");
        for (const [what, pattern] of RULES) {
          if (pattern.test(text)) offenders.push(`${path.relative(ROOT, file).split(path.sep).join("/")}: ${what}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the rule sees the shapes it looks for", () => {
    const [, darkClass] = RULES[0];
    expect(darkClass.test('className="bg-paper dark:bg-ink"')).toBe(true);
    expect(darkClass.test("dark:data-[variant=destructive]:focus:bg-x")).toBe(true);
    expect(darkClass.test("color-scheme: dark;")).toBe(false);
    expect(darkClass.test("--color-dark: red")).toBe(false);
  });
});
