import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LEGAL_PAGES, LEGAL_UPDATED, type LegalPage } from "@/lib/legal";
import en from "@/locales/en/legal.json";
import es from "@/locales/es/legal.json";
import { LEGAL_VALUES } from "./utils/values";

/**
 * "Last updated" is only true if it moves with the words. Each page's text in both languages, with the figures it
 * prints (plans, pack, placeholders), has a fingerprint here next to the date it last changed: changing either fails
 * this test until the date and the fingerprint are updated together.
 */
const RECORDED: Record<LegalPage, { updated: string; fingerprint: string }> = {
  terms: { updated: "2026-11-18", fingerprint: "ad7ea37c8ecb7335" },
  privacy: { updated: "2026-11-18", fingerprint: "59fc9978e297749d" },
  refunds: { updated: "2026-11-11", fingerprint: "a5488795fe494671" },
};

/** The values a page prints: those its strings name. */
const printed = (page: LegalPage) => Object.entries(LEGAL_VALUES).filter(([name]) => JSON.stringify(en[page]).includes(`{{${name}}}`));

const fingerprint = (page: LegalPage) => createHash("sha256").update(JSON.stringify([en[page], es[page], printed(page)])).digest("hex").slice(0, 16);

describe("the legal pages' dates", () => {
  it.each(LEGAL_PAGES)("%s: the date moves with the text", (page) => {
    const now = { updated: LEGAL_UPDATED[page], fingerprint: fingerprint(page) };
    // On a failure: set LEGAL_UPDATED.<page> (lib/legal.ts) to today's UTC date, and copy both values here.
    expect(now, `${page} changed: update LEGAL_UPDATED.${page} and RECORDED.${page} to ${JSON.stringify({ ...now, updated: "<today, UTC>" })}`).toEqual(RECORDED[page]);
  });

  it("are calendar dates", () => {
    for (const page of LEGAL_PAGES) expect(new Date(`${LEGAL_UPDATED[page]}T00:00:00Z`).toISOString().slice(0, 10)).toBe(LEGAL_UPDATED[page]);
  });
});
