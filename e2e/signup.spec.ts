import { createClerkClient } from "@clerk/backend";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { deleteAccount, ensureClerkTesting, testEmail } from "./support/accounts";
import { accountText } from "./support/app";
import { copyFor, literal, localeOf } from "./support/copy";
import { assertSandbox, required } from "./support/env";

/**
 * The real sign-up form, with bot sign-up protection left on: the Testing
 * Token the suite fetched at start is attached to every Clerk request the
 * browser makes, which is what the bot check honours. A +clerk_test
 * address takes the fixed code 424242 and sends no email. Runs once per
 * interface language: Clerk's form follows it.
 */

let email = "";

test.afterAll(async () => {
  // Whatever happened, the account does not stay behind.
  if (!email) return;
  const backend = createClerkClient({ secretKey: required("CLERK_SECRET_KEY") });
  const users = await backend.users.getUserList({ emailAddress: [email] });
  for (const user of users.data) await deleteAccount({ id: user.id });
});

test("signing up through the form works with bot sign-up protection on, in the interface language", async ({ page }, testInfo) => {
  assertSandbox();
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  email = testEmail(`signup-${locale}`);
  await ensureClerkTesting();
  await setupClerkTestingToken({ page });
  const password = `E2e-${Math.random().toString(36).slice(2)}-Pass-2026!`;

  await page.goto("/pricing");
  expect(await page.locator("html").getAttribute("lang")).toBe(locale);
  await page.getByRole("button", { name: literal(t("pricing:free.start"), "i") }).first().click();

  const fillIf = async (selector: string, value: string) => {
    const field = page.locator(selector).first();
    if (await field.isVisible({ timeout: 3_000 }).catch(() => false)) await field.fill(value);
  };
  await page.locator('input[name="emailAddress"], input[type="email"]').first().waitFor({ timeout: 30_000 });
  // Clerk's form is in the interface language: Spanish shows "Crea tu cuenta".
  if (locale === "es") await expect(page.getByText("Crea tu cuenta").first()).toBeVisible();
  await fillIf('input[name="firstName"]', "E2E");
  await fillIf('input[name="lastName"]', "Signup");
  await page.locator('input[name="emailAddress"], input[type="email"]').first().fill(email);
  await fillIf('input[name="password"]', password);
  await page.getByRole("button", { name: /^(continue|continuar)$/i }).first().click();

  const code = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  await code.waitFor({ timeout: 30_000 });
  await code.click();
  await page.keyboard.type("424242", { delay: 40 });

  // Signed in: the account page renders for this user. Clerk takes a while
  // to settle the session after the code on a cold dev server.
  await expect
    .poll(async () => page.evaluate(() => Boolean((window as unknown as { Clerk?: { user?: unknown } }).Clerk?.user)), { timeout: 60_000 })
    .toBe(true);
  expect(await accountText(page, t)).toMatch(literal(t("account:intro.titleFree")));

  const backend = createClerkClient({ secretKey: required("CLERK_SECRET_KEY") });
  const users = await backend.users.getUserList({ emailAddress: [email] });
  expect(users.data).toHaveLength(1);
});
