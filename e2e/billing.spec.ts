import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { accountText, interviewCta, mainText, openRoom, roomLength, runAnalysis, waitForAccount, warmRoutes } from "./support/app";
import { assertSandbox, webhooksReachable } from "./support/env";
import { cancelSubscriptionNow, closeOverlay, openCheckout, payInOverlay } from "./support/paddle";

/**
 * Billing end to end against the Paddle sandbox: Pro from the account
 * page and from the pricing page, a pack, a closed overlay, and a
 * cancellation that leaves the credits usable. Every step waits for the
 * webhook to land in the database, never for the overlay's word. Two
 * accounts, created and deleted here; the tunnel must be up.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

let buyer: TestAccount;
let second: TestAccount;
let analysisUrl = "";

test.beforeAll(async () => {
  assertSandbox();
  const reach = await webhooksReachable();
  if (!reach.ok) throw new Error(`the billing specs need the providers' webhooks to reach this server: ${reach.why}`);
  await warmRoutes();
  buyer = await createAccount("buyer");
  second = await createAccount("second");
});

test.afterAll(async () => {
  for (const account of [buyer, second]) if (account) await deleteAccount(account);
});

test("Pro from the account page: overlay up, button out of the way, payment, activation by webhook, URL cleaned", async ({ page }) => {
  await signIn(page, buyer);
  await page.goto("/account/billing");
  const { button } = await openCheckout(page, /get pro/i);
  // Once the overlay is up the button is disabled under its own label: "Opening checkout" is over.
  await expect(button).toBeDisabled();
  await expect(button).toHaveText(/Get Pro/);
  await expect(button).not.toHaveText(/Opening checkout/);

  await payInOverlay(page, { email: buyer.email });
  await page.waitForURL(/activating=pro_monthly&txn=txn_/, { timeout: 120_000 });
  await expect(page.getByRole("status").filter({ hasText: /Pro is active\./ })).toBeVisible({ timeout: 180_000 });
  await page.waitForURL((url) => !url.search.includes("txn="), { timeout: 60_000 });
  expect(await accountText(page)).toMatch(/You're on Pro\. Pro, renews/);
});

test("a pack from the account page lands four credits", async ({ page }) => {
  await signIn(page, buyer);
  await page.goto("/account/billing");
  await openCheckout(page, /buy 4 more interviews/i);
  await payInOverlay(page, { email: buyer.email });
  await page.waitForURL(/activating=interview_pack&txn=txn_/, { timeout: 120_000 });
  await expect(page.getByRole("status").filter({ hasText: /Your credits are in\./ })).toBeVisible({ timeout: 180_000 });
  await page.waitForURL((url) => !url.search.includes("txn="), { timeout: 60_000 });
  expect(await accountText(page)).toMatch(/Interview credits\s*4/i);
});

test("the analysis page and the room say the period pays first, for twelve minutes", async ({ page }) => {
  await signIn(page, buyer);
  analysisUrl = await runAnalysis(page);
  const cta = (await interviewCta(page).innerText()).replace(/\s+/g, " ");
  expect(cta).toMatch(/Rehearse the interview/);
  expect(cta).toMatch(/4 of 4 interviews left this period · 4 credits/i);

  await openRoom(page);
  expect(await roomLength(page)).toBe("12:00");
  const text = await mainText(page);
  expect(text).toContain("Up to 12 minutes");
  expect(text).toContain("Uses one of this period's interviews.");
});

test("cancelling the subscription now leaves a Free account whose credits still buy full interviews", async ({ page }) => {
  await signIn(page, buyer);
  const subscriptionId = await cancelSubscriptionNow(buyer.id);
  test.info().annotations.push({ type: "paddle", description: `cancelled ${subscriptionId} effective immediately` });

  const text = await waitForAccount(page, (t) => /You're on Free\./.test(t));
  expect(text).toMatch(/Your Pro subscription ended/);
  expect(text).toMatch(/Interview credits\s*4/i);
  expect(text).toContain("Each one is a full 12-minute interview, on any plan.");

  // The attempt opened in the previous test is still waiting: the page
  // offers the room, and the room's label is what pays now.
  await page.goto(analysisUrl);
  const cta = (await interviewCta(page).innerText()).replace(/\s+/g, " ");
  expect(cta).toMatch(/Open the interview room/i);

  await openRoom(page);
  expect(await roomLength(page)).toBe("12:00");
  const room = await mainText(page);
  expect(room).toContain("Up to 12 minutes");
  expect(room).toContain("Uses one credit.");
});

test("Pro from the pricing page", async ({ page }) => {
  await signIn(page, second);
  await page.goto("/pricing");
  await openCheckout(page, /get pro/i);
  await payInOverlay(page, { email: second.email });
  await page.waitForURL(/\/account\/billing\?activating=pro_monthly&txn=txn_/, { timeout: 120_000 });
  await expect(page.getByRole("status").filter({ hasText: /Pro is active\./ })).toBeVisible({ timeout: 180_000 });
  await page.waitForURL((url) => !url.search.includes("txn="), { timeout: 60_000 });
  expect(await accountText(page)).toMatch(/You're on Pro\./);
});

test("closing the overlay without paying leaves the button idle and charges nothing", async ({ page }) => {
  await signIn(page, second);
  await page.goto("/account/billing");
  const { button } = await openCheckout(page, /buy 4 more interviews/i);
  await closeOverlay(page);
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await expect(button).toHaveText(/Buy 4 more interviews/);
  expect(page.url()).not.toContain("txn=");
  expect(await accountText(page)).toMatch(/Interview credits\s*0/i);
});
