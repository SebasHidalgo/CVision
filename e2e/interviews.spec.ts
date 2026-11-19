import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { mainText } from "./support/app";
import { copyFor, localeOf } from "./support/copy";
import { db } from "./support/db";
import { assertSandbox } from "./support/env";
import { seedAnalysis, seedCompletedInterview, setUsage } from "./support/seed";
import { seedListInterview, setCreatedAt, setRole } from "./support/seedInterviews";

// The interviews list: every state a row can be in, newest first, each row's way to its analysis, the plan line,
// the empty list, and the interviews Free's history hides (their own block, deleted one by one and all at once).
// Seeded, no call, no model; no pending feedback page is opened (it would generate). The seeded finished interviews
// issued no conversation, so deleting them asks nothing of the voice platform.

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
  for (const [state, minutesAgo] of [["expired", 60], ["failed", 50], ["pending", 40], ["endedEarly", 30], ["dropped", 20], ["live", 10], ["scheduled", 0]] as const) {
    seeded.push([state, await seedListInterview(account, analysisId, state, { minutesAgo })]);
  }

  await signIn(page, account);
  await page.goto("/interviews");
  const rows = page.locator("[data-interview-row]");
  await expect(rows).toHaveCount(seeded.length);

  // Newest first.
  const order = await rows.evaluateAll((items) => items.map((item) => item.querySelector("[data-row-link]")?.getAttribute("href") ?? ""));
  const expected = [...seeded].reverse().map(([state, id]) => (["done", "expired", "failed", "pending"].includes(state) ? `/interview/${id}/feedback` : `/interview/${id}`));
  expect(order).toEqual(expected);

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

test("Pro to Free: the interviews of hidden analyses come apart, and are deleted one by one and all at once with their feedback", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const moved = await createAccount(`interviews-moved-${localeOf(testInfo)}`);
  try {
    await setUsage(moved, { plan: "PRO" });
    // Five analyses an hour apart, an interview on the two oldest and on the newest. Free shows the last three analyses.
    const start = Date.now() - 10 * 86_400_000;
    const analyses: string[] = [];
    for (let i = 0; i < 5; i += 1) analyses.push(await seedAnalysis(moved, { createdAt: new Date(start + i * 3_600_000), jobTitle: `Role ${i + 1}`, translated: false }));
    const seeded: Record<"first" | "second" | "newest", string> = { first: "", second: "", newest: "" };
    for (const [name, at, minutesAgo] of [["first", 0, 30], ["second", 1, 20], ["newest", 4, 10]] as const) {
      seeded[name] = await seedCompletedInterview(moved, analyses[at]);
      await setRole(seeded[name], `Interview ${at + 1}`);
      await setCreatedAt(seeded[name], minutesAgo);
    }
    const feedbackOf = async (interviewId: string) => (await db.interviewFeedback.findUniqueOrThrow({ where: { interviewId }, select: { id: true } })).id;
    const firstFeedback = await feedbackOf(seeded.first);
    const secondFeedback = await feedbackOf(seeded.second);
    const { companyName } = await db.resumeAnalysis.findUniqueOrThrow({ where: { id: analyses[0] }, select: { companyName: true } });

    await signIn(page, moved);
    await page.goto("/interviews");
    const rows = page.locator("[data-interview-row]");
    const block = page.locator("[data-hidden-interviews]");
    const hidden = block.locator("[data-hidden-interview]");
    // Pro shows everything.
    await expect(rows).toHaveCount(3, { timeout: 60_000 });
    await expect(block).toHaveCount(0);

    // The plan ends: the two interviews of the analyses beyond the last three come apart, named but never opened.
    await setUsage(moved, { plan: "FREE" });
    await page.reload();
    await expect(rows).toHaveCount(1, { timeout: 60_000 });
    await expect(hidden).toHaveCount(2);
    await expect(block).toContainText(t("interview:list.hidden.title", { count: 2 }));
    await expect(block).toContainText(t("interview:list.hidden.why", { limit: 3 }));
    await expect(hidden.first()).toContainText("Interview 2");
    await expect(hidden.first()).toContainText(companyName);
    await expect(hidden.locator("a")).toHaveCount(0);
    expect(await rows.allInnerTexts()).not.toContainEqual(expect.stringContaining("Interview 1"));
    // Its room and its feedback page don't open: both come back to the list, where the block is.
    for (const path of [`/interview/${seeded.first}`, `/interview/${seeded.first}/feedback`]) {
      await page.goto(path);
      await page.waitForURL((url) => url.pathname === "/interviews");
    }
    await expect(hidden).toHaveCount(2, { timeout: 60_000 });

    // One: the row, its feedback and that feedback's translation go; its analysis stays.
    await hidden.filter({ hasText: "Interview 1" }).getByRole("button").click();
    await page.getByRole("alertdialog").getByRole("button", { name: t("interview:list.hidden.confirm.oneConfirm") }).click();
    await expect(hidden).toHaveCount(1);
    await expect(page.locator("[data-deletion-outcome]")).toHaveText(t("interview:list.hidden.result.deletedOne", { role: "Interview 1", companyName }));
    expect(await db.interview.count({ where: { id: seeded.first } })).toBe(0);
    expect(await db.interviewFeedback.count({ where: { id: firstFeedback } })).toBe(0);
    expect(await db.contentTranslation.count({ where: { interviewFeedbackId: firstFeedback } })).toBe(0);
    expect(await db.resumeAnalysis.count({ where: { id: analyses[0] } })).toBe(1);

    // All: the last hidden one goes; the visible interview and every analysis stay.
    await block.getByRole("button", { name: t("interview:list.hidden.deleteAll", { count: 1 }), exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: t("interview:list.hidden.confirm.allConfirm", { count: 1 }), exact: true }).click();
    await expect(block).toHaveCount(0);
    await expect(page.locator("[data-deletion-outcome]")).toHaveText(t("interview:list.hidden.result.deleted", { count: 1 }));
    await expect(rows).toHaveCount(1);
    expect(await db.interview.findMany({ where: { userId: moved.id }, select: { id: true } })).toEqual([{ id: seeded.newest }]);
    expect(await db.interviewFeedback.count({ where: { id: { in: [firstFeedback, secondFeedback] } } })).toBe(0);
    expect(await db.contentTranslation.count({ where: { interviewFeedbackId: { in: [firstFeedback, secondFeedback] } } })).toBe(0);
    expect(await db.resumeAnalysis.count({ where: { userId: moved.id } })).toBe(5);
  } finally {
    await deleteAccount(moved);
  }
});
