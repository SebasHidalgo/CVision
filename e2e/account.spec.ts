import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { accountOverview, accountText, switchLanguage } from "./support/app";
import { copyFor, literal, localeOf, prefix, type Copy, type SpecLocale } from "./support/copy";
import { db } from "./support/db";
import { assertSandbox } from "./support/env";
import { seedAnalysis, setUsage } from "./support/seed";
import { clearBilling, seedSubscription } from "./support/seedBilling";
import { formatLongDate } from "@/lib/format";

/**
 * The account page in every plan state (Free, Pro by comp, renewing, past due, paused, canceled at period end, ended)
 * with Plan & billing's action for each, the language switch from the account page, and deleting an account end to
 * end: the confirmation, Clerk, every row, sign-out and home. Plans are written to the database (a comp, or a mirrored
 * subscription the provider never hears of): nothing is bought and no portal is opened. Two accounts per language.
 */

test.describe.configure({ mode: "serial" });

let account: TestAccount;
let doomed: TestAccount | null = null;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`account-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) {
    // The seeded subscription first: the deletion would otherwise try to cancel it at the provider.
    await clearBilling(account);
    await deleteAccount(account);
  }
  if (doomed) await deleteAccount(doomed);
});

/** The first of next month, UTC: Free's and a comp's reset. */
function monthEnd(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const portal = (page: Page, t: Copy) => page.getByRole("button", { name: literal(t("billing:portal.manage"), "i") });
const getPro = (page: Page, t: Copy) => page.getByRole("button", { name: prefix(t("account:actions.getPro")) });
const buyPack = (page: Page, t: Copy) => page.getByRole("button", { name: prefix(t("account:actions.buyPack", { count: 4 })) });

test("Free: the plan, this month's analyses, the trial, and no interviews or credits it doesn't have", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await signIn(page, account);
  const { text, usage, standing } = await accountOverview(page, t);
  expect(standing).toBe("free");
  expect(text).toContain(t("account:planLine.free", { analyses: 3, history: 3 }));
  expect(text).toContain(t("account:overview.usage.resets", { date: formatLongDate(monthEnd(), locale) }));
  expect(usage).toMatch(new RegExp(`${literal(t("account:analyses.label")).source}\\s*3\\s*${literal(t("account:analyses.left", { limit: 3 })).source}`, "i"));
  expect(usage).toMatch(new RegExp(`${literal(t("account:trial.label")).source}\\s*${literal(t("account:trial.available")).source}`, "i"));
  expect(usage).not.toMatch(/\b0\s+(of|de)\s+0\b/);
  expect(usage).not.toMatch(literal(t("account:credits.label"), "i"));
  await expect(page.getByRole("link", { name: literal(t("account:overview.plan.seePro"), "i") })).toHaveAttribute("href", "/pricing");

  // Plan & billing sells Pro, and no pack.
  await accountText(page, t);
  await expect(getPro(page, t)).toBeVisible();
  await expect(buyPack(page, t)).toHaveCount(0);
});

test("Pro by comp: the period's interviews, analyses as 'up to 50', credits at zero, nothing to manage", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await setUsage(account, { plan: "PRO", interviewsUsed: 1 });
  try {
    await signIn(page, account);
    const { text, usage, standing } = await accountOverview(page, t);
    expect(standing).toBe("comp");
    expect(text).toContain(t("account:planLine.comp"));
    expect(usage).toMatch(new RegExp(`${literal(t("account:interviews.label")).source}\\s*3\\s*${literal(t("account:interviews.left", { limit: 4 })).source}`, "i"));
    expect(usage).toContain(t("account:analyses.upTo", { limit: 50 }));
    expect(usage).toMatch(new RegExp(`${literal(t("account:credits.label")).source}\\s*0`, "i"));
    expect(usage).not.toMatch(literal(t("account:trial.label"), "i"));

    await accountText(page, t);
    expect(await page.locator("main").innerText()).toContain(t("account:subscription.comp"));
    await expect(buyPack(page, t)).toBeVisible();
    await expect(getPro(page, t)).toHaveCount(0);
    await expect(portal(page, t)).toHaveCount(0);
  } finally {
    await setUsage(account, { plan: "FREE", interviewsUsed: 0 });
  }
});

test("every subscription state: its mark, its sentence with the date in full, and its action on Plan & billing", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await signIn(page, account);
  try {
    for (const [state, kind] of [
      ["active", "active"],
      ["pastDue", "past-due"],
      ["canceling", "cancels"],
      ["paused", "paused"],
      ["canceled", "canceled"],
    ] as const) {
      const { periodEnd } = await seedSubscription(account, state);
      const date = formatLongDate(periodEnd, locale);
      const { text, standing } = await accountOverview(page, t);
      expect(standing, state).toBe(kind);
      const line = {
        active: t("account:planLine.renews", { date }),
        pastDue: t("account:planLine.pastDue", { date }),
        canceling: t("account:planLine.cancels", { date }),
        paused: t("account:planLine.paused"),
        canceled: t("account:planLine.canceled"),
      }[state];
      expect(text, state).toContain(line);
      if (state === "canceling") expect(text).toContain(t("account:overview.usage.proEnds", { date }));

      await accountText(page, t);
      expect(await page.locator("[data-standing]").first().getAttribute("data-standing"), state).toBe(kind);
      // A customer exists in every seeded state: the portal is there; Pro is sold only where a checkout can succeed.
      await expect(portal(page, t), state).toBeVisible();
      await expect(getPro(page, t), state).toHaveCount(state === "canceled" ? 1 : 0);
      await expect(buyPack(page, t), state).toHaveCount(state === "paused" || state === "canceled" ? 0 : 1);
    }
  } finally {
    await clearBilling(account);
  }
});

test("the language changes in place from the account page and is kept", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const target: SpecLocale = locale === "es" ? "en" : "es";
  await signIn(page, account);
  await accountOverview(page, copyFor(locale));
  await page.getByRole("main").getByRole("button", { name: /^(EN|ES), (language|idioma):/i }).click();
  await page.getByRole("menuitemradio", { name: target === "es" ? "Español" : "English" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(copyFor(target)("account:meta.accountTitle")));
  expect(await page.locator("html").getAttribute("lang")).toBe(target);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(literal(copyFor(target)("account:meta.accountTitle")));
  // Back to the project's language for the tests that follow.
  await switchLanguage(page, locale);
});

test("deleting the account: the confirmation, every row gone, signed out at home, the Clerk account gone", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  doomed = await createAccount(`delete-${localeOf(testInfo)}`);
  const analysisId = await seedAnalysis(doomed);
  await signIn(page, doomed);
  await accountOverview(page, t);

  await page.getByRole("button", { name: literal(t("account:overview.delete.action"), "i") }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(t("account:overview.delete.confirmTitle"));
  // Keeping it first: nothing happens.
  await dialog.getByRole("button", { name: literal(t("account:overview.delete.cancel"), "i") }).click();
  await expect(dialog).toHaveCount(0);
  expect(await db.user.count({ where: { id: doomed.id } })).toBe(1);

  await page.getByRole("button", { name: literal(t("account:overview.delete.action"), "i") }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: literal(t("account:overview.delete.confirm"), "i") }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });

  expect(await db.user.count({ where: { id: doomed.id } })).toBe(0);
  expect(await db.resumeAnalysis.count({ where: { id: analysisId } })).toBe(0);
  expect(await db.usageEvent.count({ where: { userId: doomed.id } })).toBe(0);
  // Signed out: a signed-in page sends to the sign-in again.
  await page.goto("/account");
  await expect(page).not.toHaveURL(/\/account$/);
  // The Clerk account is gone too: deleting it again finds nothing.
  expect(await deleteAccount(doomed)).toBe("already-gone");
  doomed = null;
});
