import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { copyFor, literal, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";

// The live transcript on the dev room preview, with a real mouse wheel. No call, no model.

test.describe.configure({ mode: "serial" });
let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`transcript-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

/** Whether the browser would hit the element (or its last line's corners): on screen, not covered. */
const uncovered = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].pop();
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return [
      [r.left + 3, r.top + 3],
      [r.right - 3, r.bottom - 3],
    ].every(([x, y]) => {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    });
  }, selector);

for (const [width, height] of [[1366, 768], [1920, 1080]] as const) {
  test(`at ${width}x${height}: the last line is readable, scrolling up shows the jump button, and it resumes following`, async ({ page }, testInfo) => {
    const t = copyFor(localeOf(testInfo));
    await page.setViewportSize({ width, height });
    await signIn(page, account);
    await page.goto("/dev/room-preview?drip=1");
    const log = page.getByRole("log");
    await log.locator("li").nth(5).waitFor({ timeout: 60_000 });
    // Wait for enough lines to overflow the box.
    await expect.poll(() => log.evaluate((el) => el.scrollHeight > el.clientHeight + 40), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => uncovered(page, '[role="log"] li'), { timeout: 5_000 }).toBe(true);

    const box = (await log.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    const back = page.getByRole("button", { name: literal(t("interview:room.transcript.backToNewest"), "i") });
    const fresh = page.getByRole("button", { name: literal(t("interview:room.transcript.newMessages"), "i") });
    await expect(back.or(fresh)).toBeVisible({ timeout: 5_000 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(fresh).toBeVisible({ timeout: 10_000 });
    expect(await uncovered(page, "section[aria-labelledby='live-transcript-title'] button")).toBe(true);

    await fresh.click();
    await expect(fresh).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight), { timeout: 5_000 }).toBeLessThan(25);
    // Still following: the next line arrives at the bottom with no button.
    const count = await log.locator("li").count();
    await expect.poll(() => log.locator("li").count(), { timeout: 10_000 }).toBeGreaterThan(count);
    await expect.poll(() => uncovered(page, '[role="log"] li'), { timeout: 5_000 }).toBe(true);
    await expect(back.or(fresh)).toHaveCount(0);
  });
}
