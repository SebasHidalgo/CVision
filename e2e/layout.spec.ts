import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { openRoom } from "./support/app";
import { copyFor, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";
import { layoutViolations, settle, type LayoutViolation } from "./support/layout";
import { seedAnalysis } from "./support/seed";

/**
 * The main pages from a phone to a wide desktop, once per interface language: no sideways scroll, no
 * text over or under a button, a card, an illustration or other text, no text leaving its block, no
 * button that clips its text. One seeded analysis (no model call
 * for it; in Spanish, its translation on first view), one interview room opened before Start.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(1_800_000);

const WIDTHS = [375, 768, 1024, 1280, 1366, 1440, 1920] as const;
const HEIGHT: Record<(typeof WIDTHS)[number], number> = { 375: 812, 768: 1024, 1024: 768, 1280: 900, 1366: 768, 1440: 900, 1920: 1080 };

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
  // The M9 bug's shape (a nowrap label pushed over its paragraph), a clipped label, a too-wide block, a line leaving its column.
  await page.setContent(`<body style="margin:0;font:16px sans-serif">
    <section style="display:grid;grid-template-columns:1fr 120px;gap:8px;width:360px">
      <p style="margin:0">Un entrevistador de IA por voz te hace las preguntas de esta oferta.</p>
      <div style="justify-self:end"><button style="white-space:nowrap">Prueba de entrevista de 5 minutos, gratis</button></div>
    </section>
    <button style="width:60px;overflow:hidden;white-space:nowrap">Empezar la entrevista</button>
    <div style="width:600px">wide</div>
    <p style="width:100px;white-space:nowrap">Una línea que no entra en su columna</p>
  </body>`);
  const seen = await layoutViolations(page, "self-test");
  const kinds = seen.map((violation) => violation.kind).sort();
  expect(kinds).toEqual(["clipped", "horizontal-scroll", "overflow", "overlap"]);
});

test("the checks catch a heading that runs behind the illustration beside it", async ({ page }) => {
  // The M9-B hero: a nowrap phrase wider than its column, sliding under the card in the next one.
  const hero = (phrase: string) => `<body style="margin:0;font:16px sans-serif">
    <section style="display:grid;grid-template-columns:7fr 5fr;gap:40px;width:1000px;align-items:center">
      <div style="min-width:0"><h1 style="margin:0;font-size:90px;line-height:0.96">¿Tu CV ${phrase} con el puesto?</h1></div>
      <figure style="margin:0"><div style="background:#fff;box-shadow:0 2px 8px #0003;height:420px;padding:24px">Compatibilidad alta</div></figure>
    </section>
    <details><summary>Evidencia</summary><ul><li>Una línea que no se dibuja</li><li>Otra línea que no se dibuja</li></ul></details>
    <p style="margin:0">El texto que sigue a un bloque cerrado.</p>
  </body>`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(hero(`<span style="display:inline-block;white-space:nowrap">encaja de verdad</span>`));
  const broken = await layoutViolations(page, "hero");
  expect(broken.map((violation) => violation.kind).sort()).toEqual(["overflow", "overlap"]);
  expect(broken.find((violation) => violation.kind === "overlap")?.detail).toContain("Compatibilidad alta");

  // The same words free to wrap, text on its own card, a closed details block: nothing to report.
  await page.setContent(hero(`<span style="display:inline-block">encaja</span> <span style="display:inline-block">de</span> <span style="display:inline-block">verdad</span>`));
  expect(await layoutViolations(page, "hero")).toEqual([]);
});

test("the main pages hold their layout from 375 to 1920 px", async ({ page }, testInfo) => {
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
