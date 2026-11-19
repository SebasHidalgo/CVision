import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { mainText } from "./support/app";
import { copyFor, localeOf } from "./support/copy";
import { db } from "./support/db";
import { assertSandbox } from "./support/env";
import { seedAnalysis, seedCompletedInterview } from "./support/seed";
import { seedFeedbackState, seedListInterview, setCreatedAt } from "./support/seedInterviews";

// The interviews list: every state a row can be in, newest first, never a room that didn't start, each row's way to
// its analysis, the plan line, the empty list, and a row's delete. Seeded, no call, no model; no pending feedback page
// is opened (it would generate). The seeded finished interviews issued no conversation, so deleting them asks nothing
// of the voice platform.

let account: TestAccount;
let empty: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`interviews-${localeOf(testInfo)}`);
  empty = await createAccount(`interviews-empty-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
  if (empty) await deleteAccount(empty);
});

test("lists every interview newest first, says where each stands, and links each to its analysis", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const analysisId = await seedAnalysis(account);
  // Oldest first here; the list must show them the other way round.
  const done = await seedCompletedInterview(account, analysisId);
  await setCreatedAt(done, 70);
  const seeded: [string, string][] = [["done", done]];
  for (const [state, minutesAgo] of [["expired", 60], ["failed", 50], ["pending", 40], ["endedEarly", 30], ["dropped", 20], ["live", 10]] as const) {
    seeded.push([state, await seedListInterview(account, analysisId, state, { minutesAgo })]);
  }
  // A call nobody spoke in: it started, so it is listed, waiting to start again.
  const silent = await seedFeedbackState(account, analysisId, "silent");
  await setCreatedAt(silent, 5);
  seeded.push(["silent", silent]);
  // A room opened and never started: not an interview, never listed.
  const unstarted = await seedListInterview(account, analysisId, "scheduled", { minutesAgo: 0 });

  await signIn(page, account);
  await page.goto("/interviews");
  const rows = page.locator("[data-interview-row]");
  await expect(rows).toHaveCount(seeded.length);
  await expect(page.locator(`a[href="/interview/${unstarted}"]`)).toHaveCount(0);

  // Newest first.
  const order = await rows.evaluateAll((items) => items.map((item) => item.querySelector("[data-row-link]")?.getAttribute("href") ?? ""));
  const expected = [...seeded].reverse().map(([state, id]) => (["done", "expired", "failed", "pending"].includes(state) ? `/interview/${id}/feedback` : `/interview/${id}`));
  expect(order).toEqual(expected);

  // A delete only where the cascade accepts one: finished rows, never one in a call or being scored.
  await expect(page.locator('[data-interview-row][data-state="done"] button')).toHaveCount(1);
  await expect(page.locator('[data-interview-row][data-state="live"] button')).toHaveCount(0);
  await expect(page.locator('[data-interview-row][data-state="pending"] button')).toHaveCount(0);

  // Each state in its words (a Free account that never had voice: its trial makes a waiting interview ready).
  const states = await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-state")));
  expect(states).toEqual(["ready", "live", "resumable", "resumable", "pending", "failed", "expired", "done"]);
  const text = await mainText(page);
  expect(text).toContain(t("interview:list.reading.ready"));
  expect(text).toContain(t("interview:list.reading.live"));
  // A full interview whose one call used 60 s: 11:00 of interview left.
  expect(text).toContain(t("interview:list.reading.dropped", { time: "11:00" }));
  expect(text).toContain(t("interview:list.reading.endedEarly", { time: "11:00" }));
  expect(text).toContain(t("interview:list.reading.pending"));
  expect(text).toContain(t("interview:list.reading.failed"));
  expect(text).toContain(t("interview:list.reading.expired"));
  // The finished one shows its score.
  await expect(rows.last().locator("[data-row-link]")).toContainText(t("interview:list.reading.scored", { score: 68 }));

  // Every row reaches its analysis, beside its own link.
  const analysisLinks = rows.locator(`a[href="/resume/analysis/${analysisId}"]`);
  await expect(analysisLinks).toHaveCount(seeded.length);
  expect(await rows.first().locator("a a").count()).toBe(0);

  // What the plan has left: Free, its trial still there.
  await expect(page.locator("[data-plan-line]")).toContainText(t("interview:list.plan.trial", { minutes: 5 }));
});

test("with no interviews, the list says how to start one", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, empty);
  await page.goto("/interviews");
  await expect(page.getByRole("heading", { name: t("interview:list.emptyTitle") })).toBeVisible();
  await expect(page.getByRole("link", { name: t("interview:list.emptyAction") })).toHaveAttribute("href", "/resume/analyses");
  await expect(page.locator("[data-interview-row]")).toHaveCount(0);
});

test("a row deletes its interview with its feedback; its analysis and the other interviews stay", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const owner = await createAccount(`interviews-delete-${localeOf(testInfo)}`);
  try {
    const analysisId = await seedAnalysis(owner);
    const older = await seedCompletedInterview(owner, analysisId);
    await setCreatedAt(older, 30);
    const newer = await seedCompletedInterview(owner, analysisId);
    const feedbackId = (await db.interviewFeedback.findUniqueOrThrow({ where: { interviewId: older }, select: { id: true } })).id;
    const { companyName } = await db.resumeAnalysis.findUniqueOrThrow({ where: { id: analysisId }, select: { companyName: true } });
    const { role } = await db.interview.findUniqueOrThrow({ where: { id: older }, select: { role: true } });

    await signIn(page, owner);
    await page.goto("/interviews");
    const rows = page.locator("[data-interview-row]");
    await expect(rows).toHaveCount(2, { timeout: 60_000 });

    // The older one is the second row; its delete names it.
    await rows.nth(1).getByRole("button", { name: t("interview:list.delete.button"), exact: false }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(t("interview:list.delete.title"));
    await dialog.getByRole("button", { name: t("interview:list.delete.confirm") }).click();
    await expect(page.getByText(t("interview:list.delete.deleted", { role, companyName }))).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator("[data-row-link]")).toHaveAttribute("href", `/interview/${newer}/feedback`);

    expect(await db.interview.count({ where: { id: older } })).toBe(0);
    expect(await db.interviewFeedback.count({ where: { id: feedbackId } })).toBe(0);
    expect(await db.contentTranslation.count({ where: { interviewFeedbackId: feedbackId } })).toBe(0);
    expect(await db.interview.count({ where: { id: newer } })).toBe(1);
    expect(await db.resumeAnalysis.count({ where: { id: analysisId } })).toBe(1);
  } finally {
    await deleteAccount(owner);
  }
});
