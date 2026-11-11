import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { accountText, interviewCta, mainText, openRoom, roomLength, runAnalysis, waitForAccount, warmRoutes } from "./support/app";
import { copyFor, literal, localeOf, prefix, type Copy } from "./support/copy";
import { assertSandbox, webhooksReachable } from "./support/env";
import { cancelSubscriptionNow, closeOverlay, openCheckout, payInOverlay } from "./support/paddle";

/**
 * Billing end to end against the Paddle sandbox: Pro from the account
 * page and from the pricing page, a pack, a closed overlay, and a
 * cancellation that leaves the credits usable. Every step waits for the
 * webhook to land in the database, never for the overlay's word. Two
 * accounts per interface language, created and deleted here; the tunnel must be up.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

let buyer: TestAccount;
let second: TestAccount;
let analysisUrl = "";

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  const reach = await webhooksReachable();
  if (!reach.ok) throw new Error(`the billing specs need the providers' webhooks to reach this server: ${reach.why}`);
  await warmRoutes();
  buyer = await createAccount(`buyer-${localeOf(testInfo)}`);
  second = await createAccount(`second-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  for (const account of [buyer, second]) if (account) await deleteAccount(account);
});

const creditsLine = (t: Copy, count: number) => new RegExp(`${literal(t("account:credits.label")).source}\\s*${count}`, "i");

test("Pro from the account page: overlay up, button out of the way, payment, activation by webhook, URL cleaned", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, buyer);
  await page.goto("/account/billing");
  const getPro = prefix(t("account:actions.getPro"));
  const { button } = await openCheckout(page, getPro);
  // Once the overlay is up the button is disabled under its own label: "Opening checkout" is over.
  await expect(button).toBeDisabled();
  await expect(button).toHaveText(getPro);
  await expect(button).not.toHaveText(prefix(t("billing:checkout.opening")));

  await payInOverlay(page, { email: buyer.email });
  await page.waitForURL(/activating=pro_monthly&txn=txn_/, { timeout: 120_000 });
  await expect(page.getByRole("status").filter({ hasText: literal(t("account:activation.landedPro")) })).toBeVisible({ timeout: 180_000 });
  await page.waitForURL((url) => !url.search.includes("txn="), { timeout: 60_000 });
  const text = await accountText(page, t);
  expect(text).toMatch(literal(t("account:intro.titlePro")));
  expect(text).toMatch(prefix(t("account:planLine.renews"), ""));
});

test("a pack from the account page lands four credits", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, buyer);
  await page.goto("/account/billing");
  await openCheckout(page, prefix(t("account:actions.buyPack", { count: 4 })));
  await payInOverlay(page, { email: buyer.email });
  await page.waitForURL(/activating=interview_pack&txn=txn_/, { timeout: 120_000 });
  await expect(page.getByRole("status").filter({ hasText: literal(t("account:activation.landedPack")) })).toBeVisible({ timeout: 180_000 });
  await page.waitForURL((url) => !url.search.includes("txn="), { timeout: 60_000 });
  expect(await accountText(page, t)).toMatch(creditsLine(t, 4));
});

test("the analysis page and the room say the period pays first, for twelve minutes", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, buyer);
  analysisUrl = await runAnalysis(page);
  const cta = (await interviewCta(page).innerText()).replace(/\s+/g, " ");
  expect(cta).toMatch(literal(t("analysis:cta.rehearse"), "i"));
  expect(cta).toMatch(literal(`${t("analysis:cta.note.period", { count: 4, limit: 4 })} · ${t("analysis:cta.note.credits", { count: 4 })}`, "i"));

  await openRoom(page, t);
  expect(await roomLength(page, t)).toBe("12:00");
  const text = await mainText(page);
  expect(text).toContain(t("interview:room.upTo", { count: 12 }));
  expect(text).toContain(t("interview:room.source.period"));
});

test("cancelling the subscription now leaves a Free account whose credits still buy full interviews", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, buyer);
  const subscriptionId = await cancelSubscriptionNow(buyer.id);
  test.info().annotations.push({ type: "paddle", description: `cancelled ${subscriptionId} effective immediately` });

  const titleFree = literal(t("account:intro.titleFree"));
  const text = await waitForAccount(page, t, (body) => titleFree.test(body));
  expect(text).toMatch(prefix(t("account:planLine.canceled"), ""));
  expect(text).toMatch(creditsLine(t, 4));
  expect(text).toContain(t("account:credits.free", { minutes: 12 }));

  // The attempt opened in the previous test is still waiting: the page
  // offers the room, and the room's label is what pays now.
  await page.goto(analysisUrl);
  const cta = (await interviewCta(page).innerText()).replace(/\s+/g, " ");
  expect(cta).toMatch(literal(t("analysis:cta.openRoom"), "i"));

  await openRoom(page, t);
  expect(await roomLength(page, t)).toBe("12:00");
  const room = await mainText(page);
  expect(room).toContain(t("interview:room.upTo", { count: 12 }));
  expect(room).toContain(t("interview:room.source.credit"));
});

test("Pro from the pricing page", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, second);
  await page.goto("/pricing");
  await openCheckout(page, prefix(t("pricing:pro.checkout")));
  await payInOverlay(page, { email: second.email });
  await page.waitForURL(/\/account\/billing\?activating=pro_monthly&txn=txn_/, { timeout: 120_000 });
  await expect(page.getByRole("status").filter({ hasText: literal(t("account:activation.landedPro")) })).toBeVisible({ timeout: 180_000 });
  await page.waitForURL((url) => !url.search.includes("txn="), { timeout: 60_000 });
  expect(await accountText(page, t)).toMatch(literal(t("account:intro.titlePro")));
});

test("closing the overlay without paying leaves the button idle and charges nothing", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, second);
  await page.goto("/account/billing");
  const buyPack = prefix(t("account:actions.buyPack", { count: 4 }));
  const { button } = await openCheckout(page, buyPack);
  await closeOverlay(page);
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await expect(button).toHaveText(buyPack);
  expect(page.url()).not.toContain("txn=");
  expect(await accountText(page, t)).toMatch(creditsLine(t, 0));
});
