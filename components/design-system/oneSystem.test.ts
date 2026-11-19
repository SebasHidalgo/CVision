import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One design system, with plain names: neither the `ed-` prefix of the migration years nor any name of the old light
 * system (paper, the score tones, the studio inversion, shadcn's semantic colours and its components, Schibsted, the old
 * typography utilities) may come back into the code.
 */
const ROOT = process.cwd();
const DIRS = ["app", "components", "screens", "hooks", "lib", "types"];
const COLOR = "(?:text|bg|border|from|via|to|ring|fill|stroke|decoration|outline|divide|caret|accent|placeholder)";

const FORBIDDEN: [string, RegExp][] = [
  ["the ed- prefix", /(?<![A-Za-z0-9_])ed-[a-z0-9]/],
  ["the ED_ token constants", /\bED_(?:COLOR|RADIUS)\b/],
  ["an old colour", new RegExp(`(?<![A-Za-z0-9_-])${COLOR}-(?:paper(?:-[23])?|line-strong|signal-soft|strong(?:-soft)?|fair(?:-soft)?|weak(?:-soft)?|studio[a-z0-9-]*)(?![A-Za-z0-9_-])`)],
  ["a shadcn colour", new RegExp(`(?<![A-Za-z0-9_-])${COLOR}-(?:background|foreground|card(?:-foreground)?|popover(?:-foreground)?|primary(?:-foreground)?|secondary(?:-foreground)?|muted(?:-foreground)?|accent-foreground|destructive(?:-foreground)?|input)(?![A-Za-z0-9_-])`)],
  ["an old CSS variable", /var\(--(?:paper|studio|glow-signal|font-schibsted|shadow-float|shadow-sheet|backdrop)\b/],
  ["an old utility", /(?<![A-Za-z0-9_-])(?:display-(?:xl|lg|md|sm)|link-rule|glow-signal|grid-paper|details-reset)(?![A-Za-z0-9_-])/],
  ["Schibsted", /Schibsted/],
  ["shadcn's components", /components\/ui\//],
];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    // Tests may name an old class to assert it is gone; this file names them all.
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("one design system", () => {
  it("has no ed- name and no name of the old system in the code", () => {
    const offenders: string[] = [];
    for (const file of DIRS.flatMap((d) => walk(path.join(ROOT, d), []))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const [what, re] of FORBIDDEN) {
          const m = re.exec(line);
          if (m) offenders.push(`${path.relative(ROOT, file)}:${i + 1} ${what}: "${m[0]}"`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("catches each kind it guards", () => {
    const samples = ["text-ed-ink", "ED_COLOR", "bg-paper-2", "text-muted-foreground", "var(--paper)", "display-md", "Schibsted_Grotesk", "@/components/ui/button"];
    for (const sample of samples) expect(FORBIDDEN.some(([, re]) => re.test(sample)), sample).toBe(true);
    for (const fine of ["text-ink-2", "bg-panel", "border-line", "text-signal", "seeded-row", "tabular-nums", "max-w-page"]) {
      expect(FORBIDDEN.some(([, re]) => re.test(fine)), fine).toBe(false);
    }
  });
});
