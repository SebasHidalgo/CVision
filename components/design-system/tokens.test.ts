import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ED_COLOR, ED_RADIUS } from "./tokens";

/** tokens.css decides each value; tokens.ts copies it for Clerk. They agree, and the documented ratios hold. */

const CSS = readFileSync(path.join(__dirname, "tokens.css"), "utf8");
// The first @theme block holds the literal values; `@theme inline` only points at per-element variables.
const THEME = CSS.slice(CSS.indexOf("@theme {"), CSS.indexOf("@theme inline"));

const camel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => (/\d/.test(c) ? c : c.toUpperCase()));
const normal = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

function declared(prefix: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of THEME.matchAll(new RegExp(`--${prefix}-ed-([\\w-]+):\\s*([^;]+);`, "g"))) {
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

const GROUNDS = { bg: ED_COLOR.bg, panel: ED_COLOR.panel, raise: ED_COLOR.raise, sheet: ED_COLOR.sheet };

describe("design tokens", () => {
  it("every colour in tokens.css has its literal, with the same value", () => {
    const normalized = Object.fromEntries(Object.entries(ED_COLOR).map(([key, value]) => [key, normal(value)]));
    expect(normalized).toEqual(declared("color"));
  });

  it("the radii match tokens.css", () => {
    expect(ED_RADIUS).toEqual(declared("radius"));
  });

  it("danger text reads at 7:1 or more on every ground, and a filled danger takes the page colour as text", () => {
    for (const [ground, value] of Object.entries(GROUNDS)) {
      expect(contrast(ED_COLOR.dangerText, value), ground).toBeGreaterThanOrEqual(7);
    }
    expect(contrast(ED_COLOR.bg, ED_COLOR.dangerText)).toBeGreaterThanOrEqual(7);
    // The fill alone is not text: below 4.5:1 on the panel, which is why the text token exists.
    expect(contrast(ED_COLOR.danger, ED_COLOR.panel)).toBeLessThan(4.5);
    expect(contrast("#ffffff", ED_COLOR.danger)).toBeGreaterThanOrEqual(4.5);
  });

  it("the End button keeps a 3:1 boundary on every ground in both states, through its edge, with white text at 4.5:1 or more", () => {
    for (const [ground, value] of Object.entries(GROUNDS)) {
      expect(contrast(ED_COLOR.dangerEdge, value), ground).toBeGreaterThanOrEqual(3);
    }
    // Why the edge exists: the fill alone falls under 3:1 on raise, and the hover fill under it everywhere.
    expect(contrast(ED_COLOR.danger, ED_COLOR.raise)).toBeLessThan(3);
    expect(contrast(ED_COLOR.dangerHover, ED_COLOR.bg)).toBeLessThan(3);
    expect(contrast("#ffffff", ED_COLOR.danger)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", ED_COLOR.dangerHover)).toBeGreaterThanOrEqual(4.5);
  });

  it("a control's edge reaches 3:1 on every ground (WCAG 1.4.11); the dividers do not, so they are not edges", () => {
    for (const [ground, value] of Object.entries(GROUNDS)) {
      expect(contrast(ED_COLOR.field, value), ground).toBeGreaterThanOrEqual(3);
      expect(contrast(ED_COLOR.line2, value), ground).toBeLessThan(3);
    }
  });
});
