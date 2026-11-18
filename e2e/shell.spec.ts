import { expect, type Locator } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, ensureClerkTesting, signIn, type TestAccount } from "./support/accounts";
import { copyFor, literal, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";

/**
 * The shell over the dark design: Clerk's sign-in modal and the account menu are dark with light text (they portal
 * out of every design root, so they carry their own look), and the header's menus close on Escape with focus back
 * on what opened them. Signed out and signed in; no model, no payment.
 */

test.describe.configure({ mode: "serial" });

let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`shell-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

/** Relative luminance of the first opaque background at or above the element, and of its text. */
async function tones(locator: Locator): Promise<{ background: number; text: number; contrast: number }> {
  return locator.evaluate((el) => {
    const lum = (css: string) => {
      const [r, g, b] = (css.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map((v) => {
        const c = Number(v) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let at: Element | null = el;
    let background = "rgb(255, 255, 255)";
    for (; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      const alpha = style.backgroundColor.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1];
      if (style.backgroundColor !== "transparent" && (alpha === undefined || Number(alpha) > 0.5)) {
        background = style.backgroundColor;
        break;
      }
    }
    const [bg, fg] = [lum(background), lum(getComputedStyle(el).color)];
    return { background: bg, text: fg, contrast: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) };
  });
}

test("Clerk's sign-in opens dark over the dark header, with light text", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await page.setViewportSize({ width: 1280, height: 900 });
  await ensureClerkTesting();
  await setupClerkTestingToken({ page });
  await page.goto("/pricing");
  await page.getByRole("banner").getByRole("button", { name: literal(t("common:nav.signIn"), "i") }).click();
  const title = page.locator(".cl-headerTitle").first();
  await expect(title).toBeVisible({ timeout: 30_000 });
  const card = await tones(title);
  expect(card.background, "the card is dark").toBeLessThan(0.05);
  expect(card.contrast, "its title reads on it (AAA)").toBeGreaterThan(7);
  const input = page.locator(".cl-formFieldInput").first();
  if (await input.count()) expect((await tones(input)).contrast).toBeGreaterThan(4.5);
});

test("the account menu is dark, and Escape closes it with focus back on its button", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, account);
  await page.goto("/resume/upload");
  const button = page.getByRole("banner").getByRole("button", { name: literal(t("common:nav.accountMenu"), "i") });
  await button.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const item = menu.getByRole("menuitem").first();
  const tone = await tones(item);
  expect(tone.background).toBeLessThan(0.05);
  expect(tone.contrast, "its items read on it").toBeGreaterThan(4.5);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
});

test("on a phone the header's sheet opens, closes on Escape and gives focus back", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, account);
  await page.goto("/resume/analyses");
  const open = page.getByRole("banner").getByRole("button", { name: literal(t("common:nav.openMenu"), "i") });
  await open.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: literal(t("common:nav.analyses"), "i") })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();
});
