import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { accountText, interviewCta, mainText, openRoom, roomLength, runAnalysis, warmRoutes } from "./support/app";
import { assertSandbox } from "./support/env";

/**
 * A fresh Free account: what it is told it has, and what its one trial
 * interview looks like before Start. One analysis (one model call); no
 * call is placed.
 */

test.describe.configure({ mode: "serial" });

let account: TestAccount;

test.beforeAll(async () => {
  assertSandbox();
  await warmRoutes();
  account = await createAccount("free");
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

test("a new account is on Free, with the trial available and no credits", async ({ page }) => {
  await signIn(page, account);
  const text = await accountText(page);
  expect(text).toMatch(/You're on Free\./);
  expect(text).toContain("One free 5-minute practice interview.");
  // innerText carries the page's uppercase styling and glues the figure to its unit.
  expect(text).toMatch(/Interview credits\s*0/i);
  expect(text).toMatch(/Analyses\s*3\s*of 3 this month/i);
});

test("an analysis offers the 5-minute trial, and the room promises five minutes on the trial", async ({ page }) => {
  await signIn(page, account);
  await runAnalysis(page);
  expect((await interviewCta(page).innerText()).replace(/\s+/g, " ")).toMatch(/Try a 5-minute interview, free/i);

  await openRoom(page);
  expect(await roomLength(page)).toBe("5:00");
  const text = await mainText(page);
  expect(text).toContain("Up to 5 minutes");
  expect(text).toContain("Your free trial, on us.");
  expect(text).toMatch(/Attempt 1/i);
});
