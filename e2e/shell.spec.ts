import { expect, type Locator } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, ensureClerkTesting, signIn, testEmail, type TestAccount } from "./support/accounts";
import { copyFor, literal, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";

/**
 * The shell over the dark design: Clerk's sign-in modal and the account menu are dark with light text (they portal
 * out of every design root, so they carry their own look), Clerk's field edges reach 3:1 and its error text 4.5:1,
 * and the header's menus close on Escape with focus back on what opened them. Signed out and signed in; no model,
 * no payment. The error comes from an address no account has: nothing signs in and nothing is created.
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

/**
 * Contrast of a control's edge (its border, or the 1 px ring Clerk draws as a box-shadow, composited at its alpha)
 * against the card around it and against the control's own fill (WCAG 1.4.11 asks 3:1).
 */
async function edge(locator: Locator): Promise<{ card: number; fill: number; color: string }> {
  return locator.evaluate((el) => {
    // rgb()/rgba(), or color(srgb r g b / a) with channels in 0..1 (how Chrome computes a color-mix()).
    const rgba = (css: string) => {
      const [r = 0, g = 0, b = 0, a = 1] = (css.replace(/^color\(srgb/, "").match(/[\d.]+/g) ?? []).map(Number);
      const scale = css.startsWith("color(srgb") ? 255 : 1;
      return { rgb: [r * scale, g * scale, b * scale], a: /rgba|\//.test(css) ? a : 1 };
    };
    const lum = ([r, g, b]: number[]) =>
      [r, g, b]
        .map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (x: number[], y: number[]) => (Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05);
    const opaque = (from: Element | null) => {
      for (let at = from; at; at = at.parentElement) {
        const { rgb, a } = rgba(getComputedStyle(at).backgroundColor);
        if (getComputedStyle(at).backgroundColor !== "transparent" && a > 0.5) return rgb;
      }
      return [255, 255, 255];
    };
    const style = getComputedStyle(el);
    const bordered = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none";
    const color = bordered ? style.borderTopColor : (style.boxShadow.match(/(?:rgba?|color)\([^)]*\)/)?.[0] ?? "rgba(0, 0, 0, 0)");
    const card = opaque(el.parentElement);
    const own = rgba(style.backgroundColor);
    const fill = own.a > 0.5 ? own.rgb : card;
    // A translucent edge reads as its colour laid over what is behind it: the card outside, the fill inside.
    const { rgb, a } = rgba(color);
    const over = (ground: number[]) => rgb.map((v, i) => v * a + ground[i] * (1 - a));
    return { card: ratio(over(card), card), fill: ratio(over(fill), fill), color };
  });
}

test("Clerk's sign-in opens dark over the dark header, with light text and field edges that read", async ({ page }, testInfo) => {
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
  await expect(input, "the sign-in form has a field").toBeVisible();
  expect((await tones(input)).contrast).toBeGreaterThan(4.5);
  // Clerk focuses the field on open: measure the edge at rest, not the focus ring.
  await input.blur();
  await page.mouse.move(0, 0);
  const field = await edge(input);
  expect(field.card, `the field's edge (${field.color}) reads against the card (WCAG 1.4.11)`).toBeGreaterThanOrEqual(3);
  expect(field.fill, `the field's edge (${field.color}) reads against its own fill`).toBeGreaterThanOrEqual(3);
});

test("Clerk's error text reads on its card, and so does the edge of the field in error", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await page.setViewportSize({ width: 1280, height: 900 });
  await ensureClerkTesting();
  await setupClerkTestingToken({ page });
  await page.goto("/pricing");
  await page.getByRole("banner").getByRole("button", { name: literal(t("common:nav.signIn"), "i") }).click();
  const input = page.locator(".cl-formFieldInput").first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  // An address no account has: Clerk answers with a field error, and nothing signs in or gets created.
  await input.fill(testEmail(`shell-nobody-${localeOf(testInfo)}`));
  await input.press("Enter");
  const error = page.locator(".cl-formFieldErrorText").first();
  await expect(error, "Clerk shows a field error for an address no account has").toBeVisible({ timeout: 20_000 });
  expect((await tones(error)).contrast, "the error text reads on the card (AA)").toBeGreaterThanOrEqual(4.5);
  await input.blur();
  await page.mouse.move(0, 0);
  const field = await edge(input);
  expect(field.card, `the errored field's edge (${field.color}) reads against the card`).toBeGreaterThanOrEqual(3);
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
