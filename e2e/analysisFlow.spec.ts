import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { copyFor, localeOf } from "./support/copy";
import { db } from "./support/db";
import { assertSandbox } from "./support/env";
import { seedAnalysis, type SeededRequirement } from "./support/seed";

/**
 * The analysis flow's rules a reader relies on: the owner's requirement order on the analysis page, Free's hidden
 * analyses (shown as a count, deleted one by one and all at once), and the public edges of the app (robots.txt, an unknown URL, a private page signed out). Seeded data only, no model call.
 */

test.describe.configure({ mode: "serial" });

let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`flow-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

// Posting order 0..7 with a status and kind each. (A row without a kind fails the stored schema, so the page never
// sees one; the order's unit test covers that rule.)
const MIX: Array<[SeededRequirement["status"], "required" | "preferred"]> = [
  ["missing", "preferred"],
  ["partial", "required"],
  ["not_evident", "required"],
  ["met", "required"],
  ["met", "preferred"],
  ["missing", "required"],
  ["partial", "preferred"],
  ["met", "required"],
];
// Required first (met, partial, missing), then preferred, then "Not shown in your CV"; posting order within a tie.
const EXPECTED = [3, 7, 1, 5, 4, 6, 0, 2];

test("the analysis page lists requirements in the owner's order", async ({ page }, testInfo) => {
  // The order is the same in both languages; a rewritten list has no stored Spanish translation to show.
  test.skip(localeOf(testInfo) === "es", "language-independent; Spanish would translate the rewritten prose");
  let titles: string[] = [];
  const id = await seedAnalysis(account, {
    requirements: (list) => {
      const mixed = list.slice(0, MIX.length).map((item, i) => {
        const [status, kind] = MIX[i];
        return { ...item, status, kind, ...(status === "not_evident" ? { evidence: "", assessable: false } : {}) } as SeededRequirement;
      });
      titles = mixed.map((item) => item.requirement);
      return mixed;
    },
  });
  await signIn(page, account);
  await page.goto(`/resume/analysis/${id}`);
  const rows = page.locator("[data-requirement-status]");
  await expect(rows).toHaveCount(MIX.length, { timeout: 60_000 });

  const shown = await rows.evaluateAll((elements) =>
    elements.map((el) => ({ status: el.getAttribute("data-requirement-status"), kind: el.getAttribute("data-requirement-kind"), text: (el.textContent ?? "").replace(/\s+/g, " ") })),
  );
  const expected = EXPECTED.map((i) => ({ status: MIX[i][0], kind: MIX[i][1] }));
  expect(shown.map(({ status, kind }) => ({ status, kind }))).toEqual(expected);
  // Each row is titled by its posting line: the two required "met" keep the posting's order.
  const firstWords = (title: string) => title.replace(/\s+/g, " ").trim().slice(0, 24);
  EXPECTED.forEach((i, at) => expect(shown[at].text, `row ${at} is posting line ${i}`).toContain(firstWords(titles[i])));
});

test("robots.txt is served, an unknown URL is a 404 page, and a private page still asks to sign in", async ({ page, request }, testInfo) => {
  const robots = await request.get("/robots.txt", { maxRedirects: 0 });
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/User-agent: \*/i);

  // Signed out: the 404 page in the interface language, with a way home.
  const missing = await page.goto("/no-such-page-here");
  expect(missing?.status()).toBe(404);
  expect(await page.locator("html").getAttribute("lang")).toBe(localeOf(testInfo));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('main a[href="/"]').first()).toBeVisible();
  // A missing static file skips the proxy, so nothing can read the session: still the 404 page, never a 500.
  const asset = await request.get("/no-such-image.png", { maxRedirects: 0 });
  expect(asset.status()).toBe(404);
  expect(await asset.text()).toMatch(/<h1/);

  // A real private page signed out goes to sign-in, never to the 404; the API answers 401 JSON.
  const privatePage = await request.get("/resume/analyses", { maxRedirects: 0 });
  expect(privatePage.status(), "a private page signed out redirects").toBeGreaterThanOrEqual(300);
  expect(privatePage.status()).toBeLessThan(400);
  const api = await request.get("/api/interview/x/status", { maxRedirects: 0 });
  expect(api.status()).toBe(401);
  expect(await api.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });

  // Signed in: an unknown URL is the same 404; an analysis id nobody owns goes back to the list, as before.
  await signIn(page, account);
  expect((await page.goto("/no-such-page-here"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/resume/analysis/00000000-0000-4000-8000-000000000000");
  await page.waitForURL((url) => url.pathname === "/resume/analyses");
});

test("a Free account sees its older analyses hidden, and deletes them one by one and all at once", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const free = await createAccount(`hidden-${localeOf(testInfo)}`);
  try {
    // Five analyses an hour apart: Free shows the last three, "Role 1" and "Role 2" are the hidden ones.
    const start = Date.now() - 10 * 86_400_000;
    for (let i = 0; i < 5; i += 1) await seedAnalysis(free, { createdAt: new Date(start + i * 3_600_000), jobTitle: `Role ${i + 1}` });
    await signIn(page, free);
    await page.goto("/resume/analyses");

    const rows = page.locator("[data-analysis-row]");
    const block = page.locator("[data-hidden-analyses]");
    const hidden = block.locator("[data-hidden-analysis]");
    await expect(rows).toHaveCount(3, { timeout: 60_000 });
    await expect(hidden).toHaveCount(2);
    await expect(block).toContainText(t("analyses:hidden.title", { count: 2 }));
    expect(await rows.allInnerTexts()).not.toContainEqual(expect.stringContaining("Role 1"));
    // A hidden row names its analysis but never opens it.
    await expect(hidden.locator("a")).toHaveCount(0);

    await hidden.filter({ hasText: "Role 1" }).getByRole("button").click();
    await page.getByRole("alertdialog").getByRole("button", { name: t("analyses:confirm.oneConfirm") }).click();
    await expect(hidden).toHaveCount(1);
    await expect(block).not.toContainText("Role 1");

    await block.getByRole("button", { name: t("analyses:hidden.deleteAll", { count: 1 }), exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: t("analyses:confirm.allConfirm", { count: 1 }), exact: true }).click();
    await expect(page.locator("[data-hidden-analyses]")).toHaveCount(0);
    await expect(rows).toHaveCount(3);
    expect(await db.resumeAnalysis.count({ where: { userId: free.id } })).toBe(3);
  } finally {
    await deleteAccount(free);
  }
});
