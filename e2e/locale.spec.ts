import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { switchLanguage } from "./support/app";
import { copyFor, literal, localeOf, type SpecLocale } from "./support/copy";
import { assertSandbox } from "./support/env";

/**
 * The language itself: the browser's by default, the switcher's choice in a cookie, a signed-in
 * choice that follows the account into another browser, and a switch in place (no reload: what was
 * typed stays). No payment and no model call; the switch over an analysis being translated is in
 * smoke.spec.ts, which may call the model.
 */

test.describe.configure({ mode: "serial" });

let account: TestAccount;
const other = (locale: SpecLocale): SpecLocale => (locale === "es" ? "en" : "es");
const withoutTags = (text: string) => text.replace(/<\/?\w+>/g, "");

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`locale-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

/** A mark on the current document: it survives a soft refresh and dies with a reload. */
const markDocument = (page: Page) => page.evaluate(() => ((window as unknown as { __m9b: number }).__m9b = Math.random()));
const documentMark = (page: Page) => page.evaluate(() => (window as unknown as { __m9b?: number }).__m9b);

test("the landing and pricing pages follow the browser's language", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await page.goto("/");
  expect(await page.locator("html").getAttribute("lang")).toBe(locale);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(withoutTags(t("landing:hero.title"))));
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(t("pricing:intro.title")));
});

test("the switcher changes everything in place and is kept in a cookie", async ({ page, context }, testInfo) => {
  const locale = localeOf(testInfo);
  const target = other(locale);
  const t = copyFor(target);
  await page.goto("/pricing");
  const mark = await markDocument(page);
  await switchLanguage(page, target);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(t("pricing:intro.title")));
  expect(await documentMark(page)).toBe(mark);
  expect((await context.cookies()).find((cookie) => cookie.name === "locale")?.value).toBe(target);
  // A new page in the same browser keeps it, against the browser's Accept-Language.
  await page.goto("/");
  expect(await page.locator("html").getAttribute("lang")).toBe(target);
});

test("a signed-in choice follows the account into another browser", async ({ page, browser }, testInfo) => {
  const locale = localeOf(testInfo);
  const target = other(locale);
  await signIn(page, account);
  await page.goto("/account/billing");
  await switchLanguage(page, target);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(copyFor(target)("account:intro.titleFree")));

  // Another browser: no cookie, and an Accept-Language that asks for the original language.
  const fresh = await browser.newContext({ locale: locale === "es" ? "es-ES" : "en-US" });
  const second = await fresh.newPage();
  await second.goto("/");
  expect(await second.locator("html").getAttribute("lang")).toBe(locale);
  await signIn(second, account);
  await second.goto("/account/billing");
  expect(await second.locator("html").getAttribute("lang")).toBe(target);
  await expect(second.getByRole("heading", { level: 1 })).toHaveText(new RegExp(`${literal(copyFor(target)("account:intro.titleFree")).source}`));
  await fresh.close();
  // Back to the project's language for the tests that follow.
  await page.goto("/account/billing");
  await switchLanguage(page, locale);
});

test("a switch keeps what was typed in the upload form, with no reload", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const target = other(locale);
  await signIn(page, account);
  await page.goto("/resume/upload");
  await page.locator("#company-name").fill("Acme Analytics");
  await page.locator("#job-title").fill("Data Analyst");
  await page.locator("#job-description").fill("A posting typed before the switch, which must survive it.");
  const mark = await markDocument(page);
  const started = Date.now();
  await switchLanguage(page, target);
  const clientMs = Date.now() - started;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(copyFor(target)("upload:intro.title")));
  const fullMs = Date.now() - started;
  expect(await documentMark(page)).toBe(mark);
  await expect(page.locator("#company-name")).toHaveValue("Acme Analytics");
  await expect(page.locator("#job-title")).toHaveValue("Data Analyst");
  await expect(page.locator("#job-description")).toHaveValue("A posting typed before the switch, which must survive it.");
  console.log(`[timing] upload ${locale}→${target}: client strings ${clientMs} ms, fully switched ${fullMs} ms`);
  await switchLanguage(page, locale);
});
