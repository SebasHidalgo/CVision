import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { openRoom } from "./support/app";
import { copyFor, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";
import { layoutViolations, settle, type LayoutViolation } from "./support/layout";
import { seedAnalysis } from "./support/seed";

/**
 * The main pages at a phone, a tablet and a laptop width, once per interface language: no sideways
 * scroll, no text over a button, no button that clips its text. One seeded analysis (no model call
 * for it; in Spanish, its translation on first view), one interview room opened before Start.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const WIDTHS = [375, 768, 1280] as const;
const HEIGHT: Record<(typeof WIDTHS)[number], number> = { 375: 812, 768: 1024, 1280: 900 };

let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`layout-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

async function check(page: import("@playwright/test").Page, urls: Array<[string, string]>, found: LayoutViolation[]) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT[width] });
    for (const [label, url] of urls) {
      await page.goto(url);
      await settle(page);
      found.push(...(await layoutViolations(page, label)));
    }
  }
}

test("the checks catch what they look for", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // The M9 bug's shape (a nowrap label pushed over its paragraph), a clipped label, and a too-wide block.
  await page.setContent(`<body style="margin:0;font:16px sans-serif">
    <section style="display:grid;grid-template-columns:1fr 120px;gap:8px;width:360px">
      <p style="margin:0">Un entrevistador de IA por voz te hace las preguntas de esta oferta.</p>
      <div style="justify-self:end"><button style="white-space:nowrap">Prueba de entrevista de 5 minutos, gratis</button></div>
    </section>
    <button style="width:60px;overflow:hidden;white-space:nowrap">Empezar la entrevista</button>
    <div style="width:600px">wide</div>
  </body>`);
  const kinds = (await layoutViolations(page, "self-test")).map((violation) => violation.kind).sort();
  expect(kinds).toEqual(["clipped", "horizontal-scroll", "overlap"]);
});

test("the main pages hold their layout at 375, 768 and 1280 px", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const found: LayoutViolation[] = [];

  await check(page, [["landing", "/"], ["pricing", "/pricing"], ["terms", "/terms"]], found);

  await signIn(page, account);
  const analysisId = await seedAnalysis(account);
  await page.goto(`/resume/analysis/${analysisId}`);
  await settle(page);
  const room = new URL(await openRoom(page, t)).pathname;

  await check(
    page,
    [
      ["upload", "/resume/upload"],
      ["analyses", "/resume/analyses"],
      ["analysis", `/resume/analysis/${analysisId}`],
      ["interview room", room],
      ["interviews", "/interviews"],
      ["account and billing", "/account/billing"],
      ["pricing (signed in)", "/pricing"],
    ],
    found,
  );

  for (const violation of found) console.log(`[layout] ${violation.page} @${violation.width}: ${violation.kind} — ${violation.detail}`);
  await testInfo.attach("layout-violations.json", { body: JSON.stringify(found, null, 2), contentType: "application/json" });
  expect(found).toEqual([]);
});
