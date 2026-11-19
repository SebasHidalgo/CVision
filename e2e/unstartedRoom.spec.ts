import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { interviewCta, openRoom } from "./support/app";
import { copyFor, literal, localeOf } from "./support/copy";
import { db } from "./support/db";
import { assertSandbox } from "./support/env";
import { seedAnalysis } from "./support/seed";

// A room opened and never started is not an interview: it costs nothing, it isn't listed or counted, and its analysis
// takes the candidate back to it. No Start is pressed: no call, no unit, no model.

let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`unstarted-room-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

test("a room opened without starting is not listed, reserves nothing, and its analysis goes back to it", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const analysisId = await seedAnalysis(account);

  await signIn(page, account);
  await page.goto(`/resume/analysis/${analysisId}`);
  const room = await openRoom(page, t);

  // Nothing spent: one SCHEDULED row, no unit on the ledger.
  expect(await db.interview.findMany({ where: { userId: account.id }, select: { status: true, startCount: true, usageEventId: true, issuedConversationIds: true } })).toEqual([
    { status: "SCHEDULED", startCount: 0, usageEventId: null, issuedConversationIds: [] },
  ]);
  expect(await db.usageEvent.count({ where: { userId: account.id } })).toBe(0);

  // Not an interview: the list is empty.
  await page.goto("/interviews");
  await expect(page.getByRole("heading", { name: t("interview:list.emptyTitle") })).toBeVisible();
  await expect(page.locator("[data-interview-row]")).toHaveCount(0);

  // The analysis lists no attempt, and its CTA continues to the same room; doing so creates nothing.
  await page.goto(`/resume/analysis/${analysisId}`);
  await expect(page.getByRole("list", { name: t("analysis:attempts.label") })).toHaveCount(0);
  const cta = interviewCta(page);
  await cta.getByRole("link", { name: literal(t("analysis:cta.openRoom"), "i") }).first().click();
  await page.waitForURL((url) => url.href === room);
  expect(await db.interview.count({ where: { userId: account.id } })).toBe(1);
});
