import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { copyFor, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";
import { seedAnalysis, seedInterviewAwaitingFeedback } from "./support/seed";

// The feedback page left open after a call: it shows the feedback by itself once it is stored. Seeded, no call, no model.

let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`feedback-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

test("the open feedback page shows the feedback once it is stored, with no reload", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  const analysisId = await seedAnalysis(account);
  const interview = await seedInterviewAwaitingFeedback(account, analysisId);

  await page.goto(`/interview/${interview.id}/feedback?ended=1`);
  await expect(page.getByText(t("feedback:pending.saving"))).toBeVisible();
  // Any full load from here on is a reload the user would have had to make.
  let loads = 0;
  page.on("load", () => (loads += 1));

  await interview.complete();
  await expect(page.getByRole("meter", { name: t("feedback:report.overall") })).toBeVisible({ timeout: 45_000 });
  expect(loads).toBe(0);
});
