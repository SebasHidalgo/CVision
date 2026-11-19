import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { fillAnalysisForm, interviewCta, mainText, runAnalysis, switchLanguage } from "./support/app";
import { copyFor, literal, localeOf, type SpecLocale } from "./support/copy";
import { db } from "./support/db";
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

test("a retry after the analysis's response was lost opens the analysis already saved, charged once", async ({ page }, testInfo) => {
  // The rule is the server's and the same in both languages: one paid call, in the English project only.
  test.skip(localeOf(testInfo) !== "en", "language-independent; one real analysis is enough");
  test.setTimeout(300_000);
  const t = copyFor("en");
  // Its own account, so the ledger and the analyses can be counted exactly.
  const own = await createAccount("smoke-retry");
  try {
    await signIn(page, own);
    await fillAnalysisForm(page);

    // The first analysis POST reaches the server and finishes there; its response never reaches the page. Every
    // analysis POST's submission key is recorded.
    const lost: { first?: { resumeId: string } } = {};
    const sentKeys: string[] = [];
    await page.route("**/resume/upload", async (route) => {
      const request = route.request();
      const body = request.postData() ?? "";
      if (request.method() !== "POST" || !request.headers()["next-action"] || !body.includes('"submissionKey"')) return route.fallback();
      sentKeys.push(/"submissionKey":"([0-9a-f-]{36})"/.exec(body)?.[1] ?? "");
      if (lost.first) return route.fallback();
      const response = await route.fetch({ timeout: 180_000 });
      lost.first = { resumeId: /"resumeId":"([0-9a-f-]{36})"/.exec(await response.text())?.[1] ?? "" };
      await route.abort("connectionreset");
    });

    await page.locator('button[type="submit"]').first().click();
    const notice = page.locator("[data-failure-notice]");
    await expect(notice).toBeVisible({ timeout: 180_000 });
    await expect(notice).toContainText(t("errors:codes.REQUEST_FAILED"));
    const first = lost.first;
    if (!first) throw new Error("the analysis request was never intercepted");
    expect(first.resumeId).toMatch(/^[0-9a-f-]{36}$/);
    console.log(`[smoke] the first request saved ${first.resumeId}; its response was dropped`);

    // The same submission again: a new upload, the same key, and the analysis already saved.
    const started = Date.now();
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/\/resume\/analysis\/[^/?]+$/, { timeout: 60_000 });
    console.log(`[smoke] retry → saved analysis in ${Date.now() - started} ms`);
    expect(page.url().endsWith(`/resume/analysis/${first.resumeId}`)).toBe(true);
    expect(sentKeys).toHaveLength(2);
    expect(sentKeys[1]).toBe(sentKeys[0]);

    // One analysis, one unit, nothing refunded: the retry reserved nothing and called no model.
    const analyses = await db.resumeAnalysis.findMany({ where: { userId: own.id }, select: { id: true } });
    expect(analyses.map((row) => row.id)).toEqual([first.resumeId]);
    const units = await db.usageEvent.findMany({ where: { userId: own.id, kind: "ANALYSIS" }, select: { refId: true, refundedAt: true } });
    expect(units).toEqual([{ refId: first.resumeId, refundedAt: null }]);
  } finally {
    await deleteAccount(own);
  }
});
