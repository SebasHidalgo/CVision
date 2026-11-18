import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { switchLanguage } from "./support/app";
import { localeOf, type SpecLocale } from "./support/copy";

/**
 * The landing's own behaviour: the full-page loader (it shows, it completes, its cap, never without JavaScript), a
 * language switch that reloads the landing (and only the landing), the example call's sound toggle, reduced motion,
 * and the hero fitting the first screen. Signed out, no model, no payment.
 */

const CAP_MS = 2_500;
const other = (locale: SpecLocale): SpecLocale => (locale === "es" ? "en" : "es");

/**
 * Records each change of data-loading on <html>, from before the page's own scripts run: `loading` is the value the
 * change left (null = removed). An init script runs before <html> exists, so it watches the document's subtree.
 */
async function watchLoader(page: Page) {
  await page.addInitScript(() => {
    const log: { at: number; loading: string | null }[] = [];
    (window as unknown as { __loaderLog: typeof log }).__loaderLog = log;
    new MutationObserver((records) => {
      const at = performance.now();
      records.forEach((record, i) => {
        // The value a change left is the next change's old value, or the current one for the last.
        const next = records[i + 1];
        log.push({ at, loading: next ? next.oldValue : (record.target as Element).getAttribute("data-loading") });
      });
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-loading"], attributeOldValue: true });
  });
}

const loaderLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loaderLog: { at: number; loading: string | null }[] }).__loaderLog);

async function revealed(page: Page) {
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-loading"), undefined, { timeout: 10_000 });
}

test("the loader shows on a full load of the landing, fills and hands over to the page", async ({ page }) => {
  await watchLoader(page);
  await page.goto("/");
  await revealed(page);
  const log = await loaderLog(page);
  expect(log[0]?.loading).toBe("");
  const off = log.find((entry) => entry.loading === null);
  expect(off, "the loader came down").toBeTruthy();
  // The cap counts from the boot script, which runs when the HTML arrives, not from navigation start.
  expect(off!.at - log[0].at).toBeLessThan(CAP_MS + 1_500);
  await expect(page.locator("[data-loader]")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByName("cvision:revealed").length)).toBe(1);
});

test("the cap shows the page when a part never reports ready", async ({ page }) => {
  await watchLoader(page);
  // Swallows every readiness signal before the loader hears it: only the cap can bring it down.
  await page.addInitScript(() => window.addEventListener("cvision:ready", (e) => e.stopImmediatePropagation(), true));
  await page.goto("/");
  await revealed(page);
  const log = await loaderLog(page);
  const off = log.find((entry) => entry.loading === null);
  expect(off!.at - log[0].at).toBeGreaterThan(CAP_MS - 300);
  expect(off!.at - log[0].at).toBeLessThan(CAP_MS + 1_500);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("without JavaScript there is no loader and nothing is hidden", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, locale: localeOf(testInfo) === "es" ? "es-ES" : "en-US" });
  const page = await context.newPage();
  for (const path of ["/", "/pricing", "/terms"]) {
    await page.goto(path);
    expect(await page.locator("html").getAttribute("data-loading")).toBeNull();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Nothing on the way to the headline is transparent.
    const hidden = await page.getByRole("heading", { level: 1 }).evaluate((el) => {
      for (let at: Element | null = el; at; at = at.parentElement) if (Number(getComputedStyle(at).opacity) < 1) return at.tagName;
      return null;
    });
    expect(hidden, `${path}: an ancestor of the headline is transparent`).toBeNull();
  }
  await expect(page.locator("[data-loader]")).toBeHidden();
  await context.close();
});

test("a client-side return to the landing shows no loader", async ({ page }) => {
  await page.goto("/pricing");
  await watchLoader(page);
  await page.getByRole("banner").getByRole("link").first().click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.locator("html").getAttribute("data-loading")).toBeNull();
});

test("switching the language on the landing reloads it; elsewhere it switches in place", async ({ page, context }, testInfo) => {
  const target = other(localeOf(testInfo));
  await page.goto("/");
  await revealed(page);
  await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));
  await switchLanguage(page, target);
  await revealed(page);
  expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBeUndefined();
  expect((await context.cookies()).find((cookie) => cookie.name === "locale")?.value).toBe(target);

  await page.goto("/pricing");
  await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 2));
  await switchLanguage(page, localeOf(testInfo));
  expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBe(2);
});

test("the example call is muted by default, asks for no audio until sound is on, and works from the keyboard", async ({ page }) => {
  const audio: string[] = [];
  const problems: string[] = [];
  page.on("request", (request) => {
    if (/\/landing\/voice\//.test(request.url())) audio.push(request.url());
  });
  page.on("response", (response) => {
    if (/\/landing\/voice\//.test(response.url()) && response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => message.type() === "error" && problems.push(message.text().slice(0, 200)));
  await page.goto("/");
  await revealed(page);
  const section = page.locator("#interview");
  await section.scrollIntoViewIfNeeded();
  const sound = section.locator("button[aria-pressed]").first();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1_500);
  expect(audio, "no audio before sound is on").toEqual([]);
  await sound.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => audio.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(audio.every((url) => /\/landing\/voice\/(en|es)\/0\d\.mp3/.test(url))).toBe(true);
  expect(problems, "audio responses and console errors").toEqual([]);
  await expect(sound).toHaveAttribute("aria-pressed", "true");
});

test("under reduced motion the page appears at once, with no 3D scene", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await revealed(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The hero's figure is the still or the HTML figure: never a WebGL canvas.
  expect(await page.locator("#top main section").first().locator("canvas").count()).toBe(0);
});

const FIRST_SCREEN = [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
  [390, 844],
  [375, 667],
] as const;

for (const [width, height] of FIRST_SCREEN) {
  test(`the hero fits the first screen at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await revealed(page);
    const bottom = await page.locator("[data-hero]").evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
    expect(bottom).toBeLessThanOrEqual(height + 1);
  });
}
