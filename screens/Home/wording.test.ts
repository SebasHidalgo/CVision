import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The wording rule, kept by a test: everywhere a buyer or a reviewer reads
 * (the landing page, the pricing page, the account page, the legal drafts,
 * the catalog), CVision is a self-assessment and practice tool a job seeker
 * uses on their own CV and answers, with an AI interviewer. Never a
 * screening, evaluation or hiring tool, never coaching or exam prep, never
 * something employers run on other people, and the voice is never a person.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SCOPES = ["screens/Home", "screens/Pricing", "screens/AccountBilling", "screens/Legal", "lib/billing/catalog.ts", "components/billing", "components/layout/Footer.tsx"];
// The same pages' words, now in locales/: every namespace a buyer or a reviewer reads, in every language.
const LOCALE_NAMESPACES = ["common", "landing", "pricing", "account", "billing", "legal"];

const FORBIDDEN = [
  /candidate evaluation/i,
  /\bscreening\b/i,
  /screen candidates/i,
  /hiring decision/i,
  /hiring manager/i,
  /\brecruiter/i,
  /\bemployer/i,
  /\bcoach(ing)?\b/i,
  /exam prep/i,
  /\bimitat/i,
  /real person/i,
  /sounds like a human/i,
  // Spanish: the same rule, "herramienta de autoevaluación y práctica".
  /evaluaci[oó]n de candidatos/i,
  /selecci[oó]n de personal/i,
  /preparaci[oó]n (?:de|para) ex[aá]menes/i,
  /decisi[oó]n(?:es)? de contrataci[oó]n/i,
  /\breclutador/i,
  /\bempleador/i,
  /filtr(?:o|ado|ar) (?:de )?candidatos/i,
  /\bimita/i,
  /persona real/i,
  /suena (?:como|a) (?:un )?humano/i,
];

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

describe("the wording rule", () => {
  it("holds in every page a buyer or a reviewer reads", () => {
    const offenders: string[] = [];
    for (const scope of SCOPES) {
      for (const file of files(scope)) {
        const text = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN) {
          const match = pattern.exec(text);
          if (match) offenders.push(`${path.relative(ROOT, file)}: "${match[0]}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("holds in those pages' locale files, in every language", () => {
    const offenders: string[] = [];
    for (const locale of readdirSync(path.join(ROOT, "locales"))) {
      for (const ns of LOCALE_NAMESPACES) {
        const file = path.join(ROOT, "locales", locale, `${ns}.json`);
        const text = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN) {
          const match = pattern.exec(text);
          if (match) offenders.push(`locales/${locale}/${ns}.json: "${match[0]}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
