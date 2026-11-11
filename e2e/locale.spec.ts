import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { copyFor, literal, localeOf, type SpecLocale } from "./support/copy";
import { assertSandbox } from "./support/env";

/**
 * The language itself: the browser's by default, the switcher's choice in a cookie, and a
 * signed-in choice that follows the account into another browser. No model call, no payment.
 */

test.describe.configure({ mode: "serial" });

let account: TestAccount;
const other = (locale: SpecLocale): SpecLocale => (locale === "es" ? "en" : "es");
const withoutTags = (text: string) => text.replace(/<\/?\w+>/g, "");
// The switcher's buttons are named for their language, in that language ("Switch to Español").
const NAMES: Record<SpecLocale, RegExp> = { en: /English/, es: /Español/ };

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`locale-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

test("the landing and pricing pages follow the browser's language", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await page.goto("/");
  expect(await page.locator("html").getAttribute("lang")).toBe(locale);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(withoutTags(t("landing:hero.title"))));
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(t("pricing:intro.title")));
});

test("the switcher changes everything and is kept in a cookie", async ({ page, context }, testInfo) => {
  const locale = localeOf(testInfo);
  const target = other(locale);
  const t = copyFor(target);
  await page.goto("/pricing");
  await page.getByRole("button", { name: NAMES[target] }).first().click();
  await page.waitForFunction((lang) => document.documentElement.lang === lang, target, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(t("pricing:intro.title")));
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
  await page.getByRole("button", { name: NAMES[target] }).first().click();
  await page.waitForFunction((lang) => document.documentElement.lang === lang, target, { timeout: 30_000 });

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
});
