import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, RADIUS_TOKENS } from "./tokens";

/** tokens.css decides each value; tokens.ts copies it for Clerk. They agree, and the documented ratios hold. */

const CSS = readFileSync(path.join(__dirname, "tokens.css"), "utf8");
// The first @theme block holds the literal values; `@theme inline` only points at per-element variables.
const THEME = CSS.slice(CSS.indexOf("@theme {"), CSS.indexOf("@theme inline"));

const camel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => (/\d/.test(c) ? c : c.toUpperCase()));
const normal = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

function declared(prefix: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of THEME.matchAll(new RegExp(`--${prefix}-([\\w-]+):\\s*([^;]+);`, "g"))) {
    found[camel(name)] = normal(value);
  }
  return found;
}

/** WCAG 2.x contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GROUNDS = { bg: COLOR_TOKENS.bg, panel: COLOR_TOKENS.panel, raise: COLOR_TOKENS.raise, sheet: COLOR_TOKENS.sheet };

describe("design tokens", () => {
  it("every colour in tokens.css has its literal, with the same value", () => {
    const normalized = Object.fromEntries(Object.entries(COLOR_TOKENS).map(([key, value]) => [key, normal(value)]));
    expect(normalized).toEqual(declared("color"));
  });

  it("the radii match tokens.css", () => {
    expect(RADIUS_TOKENS).toEqual(declared("radius"));
  });

  it("danger text reads at 7:1 or more on every ground, and a filled danger takes the page colour as text", () => {
    for (const [ground, value] of Object.entries(GROUNDS)) {
      expect(contrast(COLOR_TOKENS.dangerText, value), ground).toBeGreaterThanOrEqual(7);
    }
    expect(contrast(COLOR_TOKENS.bg, COLOR_TOKENS.dangerText)).toBeGreaterThanOrEqual(7);
    // The fill alone is not text: below 4.5:1 on the panel, which is why the text token exists.
    expect(contrast(COLOR_TOKENS.danger, COLOR_TOKENS.panel)).toBeLessThan(4.5);
    expect(contrast("#ffffff", COLOR_TOKENS.danger)).toBeGreaterThanOrEqual(4.5);
  });

  it("the End button keeps a 3:1 boundary on every ground in both states, through its edge, with white text at 4.5:1 or more", () => {
    for (const [ground, value] of Object.entries(GROUNDS)) {
      expect(contrast(COLOR_TOKENS.dangerEdge, value), ground).toBeGreaterThanOrEqual(3);
    }
    // Why the edge exists: the fill alone falls under 3:1 on raise, and the hover fill under it everywhere.
    expect(contrast(COLOR_TOKENS.danger, COLOR_TOKENS.raise)).toBeLessThan(3);
    expect(contrast(COLOR_TOKENS.dangerHover, COLOR_TOKENS.bg)).toBeLessThan(3);
    expect(contrast("#ffffff", COLOR_TOKENS.danger)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", COLOR_TOKENS.dangerHover)).toBeGreaterThanOrEqual(4.5);
  });

  it("a control's edge reaches 3:1 on every ground (WCAG 1.4.11); the dividers do not, so they are not edges", () => {
    for (const [ground, value] of Object.entries(GROUNDS)) {
      expect(contrast(COLOR_TOKENS.field, value), ground).toBeGreaterThanOrEqual(3);
      expect(contrast(COLOR_TOKENS.line2, value), ground).toBeLessThan(3);
    }
  });
});
