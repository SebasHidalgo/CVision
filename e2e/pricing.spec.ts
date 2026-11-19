import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { mainText } from "./support/app";
import { copyFor, literal, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";
import { setUsage } from "./support/seed";
import { clearBilling, seedSubscription } from "./support/seedBilling";
import { formatLongDate, formatMoney } from "@/lib/format";

/**
 * The pricing page in every plan state, each with its words and its action: a visitor, Free (trial waiting, trial
 * used, after Pro), Pro by comp, Pro by subscription, past due, canceled at period end, paused. The plan is written
 * to the database (a comp, or a mirrored subscription the provider never hears of): nothing is bought, no checkout or
 * portal is opened. One account per interface language.
 */

test.describe.configure({ mode: "serial" });

let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`pricing-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (!account) return;
  // The seeded subscription first: the deletion would otherwise try to cancel it at the provider.
  await clearBilling(account);
  await deleteAccount(account);
});

/** The page fresh, its state named on its root, and the visible words of its main. */
async function open(page: Page, kind: string) {
  await page.goto("/pricing");
  // The loading state has no data-pricing-state: this waits for the page, and a wrong state fails naming the one shown.
  await expect(page.locator("[data-pricing-state]")).toHaveAttribute("data-pricing-state", kind, { timeout: 60_000 });
  return mainText(page);
}

const button = (page: Page, name: string) => page.getByRole("button", { name: literal(name, "i") });
/** A plan's action in the wide table (the suite's viewport is 1280 px: the cards are hidden). */
const planAction = (page: Page, plan: "free" | "pro") => page.locator(`[data-pricing-part="table"] [data-plan-action="${plan}"]`);
const packButton = (page: Page) => page.locator('[data-pricing-part="pack"]').getByRole("button");

test("a visitor: the plans with a sign-up on each, and no pack to buy", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  const text = await open(page, "signed-out");
  expect(text).toContain(t("pricing:rows.analyses.pro", { count: 50 }));
  expect(text).toMatch(literal(t("pricing:pack.lead", { count: 4, price: formatMoney(9, "USD", locale) })));
  // The header has its own "Start free": the plans' buttons are read in their cells.
  await expect(planAction(page, "free").getByRole("button")).toHaveText(literal(t("pricing:free.start"), "i"));
  await expect(planAction(page, "pro").getByRole("button")).toHaveText(literal(t("pricing:pro.signUp"), "i"));
  expect(text).not.toMatch(literal(t("pricing:state.mark.yourPlan"), "i"));
  await expect(packButton(page)).toHaveCount(0);
});

test("Free: the trial waiting, then used; Pro by checkout; no pack without Pro", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await signIn(page, account);
  let text = await open(page, "free");
  expect(text).toMatch(literal(t("pricing:state.mark.yourPlan"), "i"));
  expect(text).toContain(t("pricing:state.detail.trialAvailable", { minutes: 5 }));
  await expect(button(page, t("pricing:pro.checkout", { price: formatMoney(15, "USD", locale) }))).toBeVisible();
  await expect(planAction(page, "free").getByRole("link", { name: t("common:nav.newAnalysis") })).toBeVisible();
  await expect(packButton(page)).toHaveCount(0);

  await setUsage(account, { trialUsed: true });
  text = await open(page, "free");
  expect(text).toContain(t("pricing:state.detail.trialUsed"));
});

test("Pro by comp: no portal without a billing customer, the account page instead; the pack for sale", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await setUsage(account, { plan: "PRO" });
  await signIn(page, account);
  const text = await open(page, "pro-comp");
  expect(text).toContain(t("pricing:state.detail.comp"));
  await expect(button(page, t("billing:portal.manage"))).toHaveCount(0);
  await expect(planAction(page, "pro").getByRole("link", { name: t("common:nav.planBilling") })).toBeVisible();
  await expect(packButton(page)).toHaveText(literal(t("pricing:actions.buyPack", { count: 4, price: formatMoney(9, "USD", locale) }), "i"));
  await setUsage(account, { plan: "FREE" });
});

test("Pro by subscription: renewal date, the portal, Free included, the pack; no Pro checkout", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  const { periodEnd } = await seedSubscription(account, "active");
  await signIn(page, account);
  const text = await open(page, "pro");
  expect(text).toContain(t("pricing:state.detail.renews", { date: formatLongDate(periodEnd, locale) }));
  expect(text).toContain(t("pricing:free.includedInPro"));
  await expect(button(page, t("billing:portal.manage"))).toBeVisible();
  await expect(packButton(page)).toBeVisible();
  await expect(button(page, t("pricing:pro.checkout", { price: formatMoney(15, "USD", locale) }))).toHaveCount(0);
});

test("past due: still Pro, the portal to update the payment method", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await seedSubscription(account, "pastDue");
  await signIn(page, account);
  const text = await open(page, "past-due");
  expect(text).toContain(t("pricing:state.detail.pastDue"));
  await expect(button(page, t("pricing:actions.portal.fixPayment"))).toBeVisible();
  await expect(packButton(page)).toBeVisible();
});

test("canceled at period end: Pro until the date, Free from it, the portal", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  const { periodEnd } = await seedSubscription(account, "canceling");
  const date = formatLongDate(periodEnd, locale);
  await signIn(page, account);
  const text = await open(page, "canceling");
  expect(text).toContain(t("pricing:state.detail.canceling", { date }));
  expect(text).toMatch(literal(t("pricing:state.mark.from", { date }), "i"));
  await expect(button(page, t("billing:portal.manage"))).toBeVisible();
});

test("paused: Free is the plan, the portal to resume, no Pro checkout and no pack", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await seedSubscription(account, "paused");
  await signIn(page, account);
  const text = await open(page, "paused");
  expect(text).toMatch(literal(t("pricing:state.mark.paused"), "i"));
  expect(text).toContain(t("pricing:state.detail.paused"));
  await expect(button(page, t("billing:portal.manage"))).toBeVisible();
  await expect(button(page, t("pricing:pro.checkout", { price: formatMoney(15, "USD", locale) }))).toHaveCount(0);
  await expect(packButton(page)).toHaveCount(0);
});

test("Free after Pro ended: nothing deleted, Pro by checkout again", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await seedSubscription(account, "canceled");
  await signIn(page, account);
  const text = await open(page, "free-after-pro");
  expect(text).toContain(t("pricing:state.detail.afterPro"));
  await expect(button(page, t("pricing:pro.checkout", { price: formatMoney(15, "USD", locale) }))).toBeVisible();
  await clearBilling(account);
});
