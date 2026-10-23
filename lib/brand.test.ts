import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appUrl, BRAND } from "./brand";

/**
 * Renaming the product is an edit to lib/brand.ts: no customer-facing
 * source may carry the name as a literal. The scopes are everything a
 * customer reads or a provider shows (pages, screens, components, the
 * legal drafts, the catalog, the agent names, the prompts, the error copy).
 * The `[CVision]` log tags are internal and allowed; test files and the
 * `cvision-theme` storage key (lowercase, a browser-local identifier whose
 * change would reset every visitor's theme) are not customer-facing.
 */

const ROOT = path.resolve(__dirname, "..");
const SCOPES = ["app", "screens", "components", "lib/ai/prompts", "lib/billing/catalog.ts", "lib/billing/paddle/catalog.ts", "lib/elevenlabs/agentConfig.ts", "lib/legal.ts", "lib/error/actionErrorCopy.ts"];
const LITERAL = /CVision/g;
const LOG_TAG = /\[CVision\]/g;

function* files(target: string): Generator<string> {
  const full = path.join(ROOT, target);
  if (statSync(full).isFile()) {
    yield full;
    return;
  }
  for (const name of readdirSync(full)) {
    const child = path.join(full, name);
    if (statSync(child).isDirectory()) yield* files(path.relative(ROOT, child));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield child;
  }
}

describe("the brand lives in one file", () => {
  it("no customer-facing source names the product as a literal outside lib/brand.ts", () => {
    const offenders: string[] = [];
    for (const scope of SCOPES) {
      for (const file of files(scope)) {
        const text = readFileSync(file, "utf8").replace(LOG_TAG, "");
        const hits = text.match(LITERAL);
        if (hits) offenders.push(`${path.relative(ROOT, file).split(path.sep).join("/")} (${hits.length})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("holds the name, a tagline and the two legal placeholders, never an invented entity", () => {
    expect(BRAND.name).toBe("CVision");
    expect(BRAND.tagline.length).toBeGreaterThan(10);
    expect(BRAND.legalEntityName).toBe("LEGAL_ENTITY_NAME");
    expect(BRAND.supportEmail).toBe("LEGAL_CONTACT_EMAIL");
  });
});

describe("appUrl", () => {
  it("reads NEXT_PUBLIC_APP_URL without a trailing slash, and falls back to the local server", () => {
    expect(appUrl({ NEXT_PUBLIC_APP_URL: "https://example.com/" })).toBe("https://example.com");
    expect(appUrl({ NEXT_PUBLIC_APP_URL: "https://example.com" })).toBe("https://example.com");
    expect(appUrl({ NEXT_PUBLIC_APP_URL: "  " })).toBe("http://localhost:3000");
    expect(appUrl({})).toBe("http://localhost:3000");
  });
});
