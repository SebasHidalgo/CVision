import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { copyFor, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";
import { seedAnalysis, seedCompletedInterview } from "./support/seed";
import { seedListInterview } from "./support/seedInterviews";

// Every plan sees every analysis and interview it owns (the limits apply to what is created), and ownership is the
// only gate: another account's ids read as missing. Seeded, no call, no model: every seeded analysis and report carries
// its stored Spanish translation, and no pending feedback page is opened.

let free: TestAccount;
let other: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  free = await createAccount(`history-${localeOf(testInfo)}`);
  other = await createAccount(`history-other-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (free) await deleteAccount(free);
  if (other) await deleteAccount(other);
});

test("a Free account sees all its history: every analysis and interview listed and openable", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  // Five analyses an hour apart, more than Free's three a month; interviews on the two oldest and on the newest.
  const start = Date.now() - 10 * 86_400_000;
  const analyses: string[] = [];
  for (let i = 0; i < 5; i += 1) analyses.push(await seedAnalysis(free, { createdAt: new Date(start + i * 3_600_000) }));
  const interviews = [await seedCompletedInterview(free, analyses[0]), await seedCompletedInterview(free, analyses[1]), await seedCompletedInterview(free, analyses[4])];

  await signIn(page, free);
  await page.goto("/resume/analyses");
  const rows = page.locator("[data-analysis-row]");
  await expect(rows).toHaveCount(5, { timeout: 60_000 });
  for (const id of analyses) await expect(page.locator(`a[href="/resume/analysis/${id}"]`)).toHaveCount(1);

  // Each one opens, the oldest included, with its interview among its attempts.
  for (const id of analyses) {
    await page.goto(`/resume/analysis/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/resume/analysis/${id}`);
  }
  await page.goto(`/resume/analysis/${analyses[0]}`);
  await expect(page.getByRole("list", { name: t("analysis:attempts.label") }).locator(`a[href="/interview/${interviews[0]}/feedback"]`)).toHaveCount(1);

  await page.goto("/interviews");
  await expect(page.locator("[data-interview-row]")).toHaveCount(3, { timeout: 60_000 });
  for (const id of interviews) {
    await page.goto(`/interview/${id}/feedback`);
    await expect(page.getByRole("meter", { name: t("feedback:report.overall") })).toBeVisible({ timeout: 45_000 });
    expect(new URL(page.url()).pathname).toBe(`/interview/${id}/feedback`);
  }
});

test("another account's analysis, room and feedback read as missing", async ({ page }) => {
  const analysisId = await seedAnalysis(other);
  const finished = await seedCompletedInterview(other, analysisId);
  const room = await seedListInterview(other, analysisId, "scheduled");

  await signIn(page, free);
  await page.goto(`/resume/analysis/${analysisId}`);
  await page.waitForURL((url) => url.pathname === "/resume/analyses");
  for (const path of [`/interview/${room}`, `/interview/${finished}`, `/interview/${finished}/feedback`, `/interview/${room}/feedback`]) {
    await page.goto(path);
    await page.waitForURL((url) => url.pathname === "/interviews");
  }
  // And none of it is listed.
  await page.goto("/resume/analyses");
  await expect(page.locator(`a[href="/resume/analysis/${analysisId}"]`)).toHaveCount(0);
  await page.goto("/interviews");
  await expect(page.locator(`a[href^="/interview/${finished}"]`)).toHaveCount(0);
});
