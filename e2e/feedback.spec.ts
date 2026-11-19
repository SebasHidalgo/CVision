import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { copyFor, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";
import { seedAnalysis, seedCompletedInterview, seedInterviewAwaitingFeedback } from "./support/seed";
import { seedFeedbackState, seedListInterview } from "./support/seedInterviews";

// The feedback page: left open after a call it shows the feedback by itself once it is stored; a finished interview's
// report has every part; each state with no report says what happened; and the landing's "After" tab is the same report.
// Seeded, no call, no model: no page here is one whose feedback is still to be generated.

let account: TestAccount;
let analysisId: string;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`feedback-${localeOf(testInfo)}`);
  analysisId = await seedAnalysis(account);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

/** The report's parts in page order, and the kinds of rows each holds. */
async function structure(scope: Locator) {
  return scope.locator("[data-feedback-part]").evaluateAll((parts) =>
    parts.map((part) => ({
      part: part.getAttribute("data-feedback-part"),
      rows: [...new Set([...part.querySelectorAll("[data-feedback-row]")].map((row) => row.getAttribute("data-feedback-row")))].sort(),
    })),
  );
}

async function landingRevealed(page: Page) {
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-loading"), undefined, { timeout: 10_000 });
}

test("the open feedback page shows the feedback once it is stored, with no reload", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
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

test("a finished interview's report has every part, its transcript, and the way to rehearse again", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  const id = await seedCompletedInterview(account, analysisId);
  await page.goto(`/interview/${id}/feedback`);

  const report = page.locator("[data-feedback-report]");
  await expect(report).toBeVisible();
  expect((await structure(report)).map((part) => part.part)).toEqual(["header", "gaps", "answers", "readings", "points", "final", "transcript", "next"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ingeniero de Datos Senior");
  await expect(report.locator('[data-feedback-row="reading"]')).toHaveCount(5);
  // The Spanish view is the stored translation: nothing waits for one.
  await expect(page.locator("[data-prose-pending]")).toHaveCount(0);

  // The transcript is folded, and opens on its lines.
  const transcript = report.locator('details[data-feedback-part="transcript"]');
  await transcript.locator("summary").click();
  await expect(transcript.locator("[data-transcript-line]").first()).toBeVisible();

  const next = report.locator('[data-feedback-part="next"]');
  await expect(next.getByRole("link")).toHaveAttribute("href", `/resume/analysis/${analysisId}#interview-cta-title`);
  await expect(next).toContainText(t("feedback:next.title"));

  // Lists hold list items only.
  const stray = await report.locator("ol > :not(li), ul > :not(li)").count();
  expect(stray).toBe(0);
});

test("each state with no report says what happened and what is left to do", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);

  const live = await seedListInterview(account, analysisId, "live");
  await page.goto(`/interview/${live}/feedback`);
  await expect(page.locator('[data-feedback-state="live"]')).toContainText(t("feedback:mayBeLive.title"));
  await expect(page.getByRole("link", { name: t("feedback:actions.backToRoom") })).toHaveAttribute("href", `/interview/${live}`);

  const silent = await seedFeedbackState(account, analysisId, "silent");
  await page.goto(`/interview/${silent}/feedback?ended=1`);
  await expect(page.locator('[data-feedback-state="stopped"]')).toContainText(t("feedback:notScored.silent.title"));

  const failed = await seedFeedbackState(account, analysisId, "feedbackFailed");
  await page.goto(`/interview/${failed}/feedback`);
  await expect(page.locator("main").first()).toContainText(t("feedback:failure.feedbackFailed.title"));
  await expect(page.getByRole("button", { name: t("feedback:retry.again") })).toBeVisible();

  const expired = await seedListInterview(account, analysisId, "expired");
  await page.goto(`/interview/${expired}/feedback`);
  await expect(page.locator("main").first()).toContainText(t("feedback:failure.expired.title"));

  const unreadable = await seedFeedbackState(account, analysisId, "unreadable");
  await page.goto(`/interview/${unreadable}/feedback`);
  await expect(page.locator('[data-feedback-state="unreadable"]')).toContainText(t("feedback:unavailable.title"));

  // Every state keeps the way back to the list.
  await expect(page.getByRole("link", { name: t("feedback:actions.allInterviews") })).toHaveAttribute("href", "/interviews");
});

test("the landing's After tab shows the feedback page's report: the same parts, the same kinds of rows", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  const id = await seedCompletedInterview(account, analysisId);
  await page.goto(`/interview/${id}/feedback`);
  const app = await structure(page.locator("[data-feedback-report]"));

  await page.goto("/");
  await landingRevealed(page);
  const section = page.locator("#interview");
  await section.scrollIntoViewIfNeeded();
  await section.getByRole("tab", { name: new RegExp(t("landingInterview:screens.after")) }).click();
  const landing = await structure(section.locator("[data-feedback-report]"));

  expect(landing).toEqual(app);
});
