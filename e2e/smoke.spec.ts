import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { interviewCta, mainText, runAnalysis, switchLanguage } from "./support/app";
import { copyFor, literal, localeOf, type SpecLocale } from "./support/copy";
import { assertSandbox } from "./support/env";
import { seedAnalysis } from "./support/seed";

// The only specs that call the model (paid key, in the ledger); everything else runs on seeded data.

test.describe.configure({ mode: "serial" });

let account: TestAccount;
const other = (locale: SpecLocale): SpecLocale => (locale === "es" ? "en" : "es");

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`smoke-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

/** A mark on the current document: it survives a soft refresh and dies with a reload. */
const markDocument = (page: Page) => page.evaluate(() => ((window as unknown as { __m9b: number }).__m9b = Math.random()));
const documentMark = (page: Page) => page.evaluate(() => (window as unknown as { __m9b?: number }).__m9b);

test("a real analysis, in the interface language: translated when it was created, with the trial offered", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await signIn(page, account);
  const started = Date.now();
  await runAnalysis(page);
  console.log(`[smoke] analysis ${locale}: ${Date.now() - started} ms from upload to its page`);
  expect(await page.locator("html").getAttribute("lang")).toBe(locale);
  const analysis = await mainText(page);
  expect(analysis).toContain(t("analysis:dimensions.fit.label"));
  expect(analysis).not.toContain(t("common:translation.pending"));
  expect(analysis).not.toContain(t("common:translation.unavailable"));
  expect((await interviewCta(page).innerText()).replace(/\s+/g, " ")).toMatch(literal(t("analysis:cta.tryTrial", { minutes: 5 }), "i"));
});

test("an analysis switches in place: skeletons in its prose only while a translation is made, instant once stored", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const locale = localeOf(testInfo);
  await signIn(page, account);
  const id = await seedAnalysis(account, { translated: false });
  await page.goto(`/resume/analysis/${id}`);
  // The Spanish project translates on this first view; wait until the prose is in.
  await page.waitForFunction(() => !document.querySelector("[data-prose-pending]"), undefined, { timeout: 90_000 });
  const verdict = await page.getByText(copyFor(locale)("analysis:dimensions.fit.label")).first().isVisible();
  expect(verdict).toBe(true);
  const mark = await markDocument(page);

  const timeSwitch = async (target: SpecLocale) => {
    const started = Date.now();
    await switchLanguage(page, target);
    const clientMs = Date.now() - started;
    const t = copyFor(target);
    // The fixes' heading is rendered by the server: once it reads in the new language, the re-render is in.
    await expect(page.getByRole("heading", { name: literal(t("analysis:fixes.title")) })).toBeVisible();
    // Skeletons appear only where prose waits; statuses and the verdict are already there.
    const skeletons = await page.locator("[data-prose-pending]").count();
    await page.waitForFunction(() => !document.querySelector("[data-prose-pending]"), undefined, { timeout: 90_000 });
    await expect(page.getByText(t("common:translation.pending"))).toHaveCount(0);
    return { clientMs, fullMs: Date.now() - started, skeletons };
  };

  // en project: Spanish without a stored translation, then with one. es project: English, then Spanish with one.
  const first = await timeSwitch(other(locale));
  const back = await timeSwitch(locale);
  const again = await timeSwitch(other(locale));
  expect(await documentMark(page)).toBe(mark);
  console.log(`[timing] analysis ${locale}→${other(locale)} (first): client ${first.clientMs} ms, full ${first.fullMs} ms, skeleton blocks ${first.skeletons}`);
  console.log(`[timing] analysis →${locale}: client ${back.clientMs} ms, full ${back.fullMs} ms, skeleton blocks ${back.skeletons}`);
  console.log(`[timing] analysis →${other(locale)} (stored): client ${again.clientMs} ms, full ${again.fullMs} ms, skeleton blocks ${again.skeletons}`);
  // Without a stored translation the prose waits behind skeletons; a stored one needs none; English never does.
  if (locale === "en") expect(first.skeletons).toBeGreaterThan(0);
  expect(again.skeletons).toBe(0);
  expect(back.skeletons).toBe(0);
  await switchLanguage(page, locale);
});
