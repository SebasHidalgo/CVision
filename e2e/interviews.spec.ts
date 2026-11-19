import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { mainText } from "./support/app";
import { copyFor, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";
import { seedAnalysis, seedCompletedInterview } from "./support/seed";
import { seedListInterview, setCreatedAt } from "./support/seedInterviews";

// The interviews list: every state a row can be in, newest first, each row's way to its analysis, the plan line,
// and the empty list. Seeded, no call, no model; no feedback page is opened (a pending one would generate).

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
