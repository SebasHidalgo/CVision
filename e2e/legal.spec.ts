import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { copyFor, literal, localeOf } from "./support/copy";

/**
 * The legal pages as long reads, signed out, in both languages: every contents link lands on its own section below the
 * sticky header, the anchors are a stable contract (a link to /terms#fair-use from outside keeps working), the
 * contents are a sticky rail on a desktop and a plain list first on a phone, and a page shows its frame while it
 * loads. No account, no model, no payment.
 */

/** The anchors, as a contract: renaming a section's key breaks links from outside, so it is an edit here too. */
const ANCHORS = {
  terms: ["what", "account", "plans", "fair-use", "ai", "content", "ending", "liability", "contact"],
  privacy: ["responsible", "collect", "processors", "retention", "rights", "cookies"],
  refunds: ["who", "subscriptions", "packs", "problems", "contact"],
} as const;

const HEADER_PX = 64;

/** Where a section's heading sits in the viewport. */
const headingBox = (page: Page, anchor: string) =>
  page.locator(`[id="${anchor}"] h2`).evaluate((heading) => {
    const box = heading.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), viewport: window.innerHeight };
  });

for (const [name, anchors] of Object.entries(ANCHORS)) {
  test(`${name}: each contents link lands on its section, below the header, and the rail stays in view`, async ({ page }, testInfo) => {
    const t = copyFor(localeOf(testInfo));
    // Instant jumps: under reduced motion the page does not smooth-scroll.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${name}`);
    await expect(page.getByRole("heading", { level: 1, name: t(`legal:${name}.title`) })).toBeVisible();
    await expect(page.getByRole("note")).toContainText(literal(t("legal:draft.banner").slice(0, 20)));

    const toc = page.getByRole("navigation", { name: t("legal:nav.toc") });
    const links = toc.getByRole("link");
    expect(await links.evaluateAll((all) => all.map((link) => link.getAttribute("href")))).toEqual(anchors.map((anchor) => `#${anchor}`));

    for (const anchor of anchors) {
      expect(await page.locator(`[id="${anchor}"]`).count()).toBe(1);
      await toc.locator(`a[href="#${anchor}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${anchor}$`));
      const box = await headingBox(page, anchor);
      expect(box.top, `#${anchor} under the header`).toBeGreaterThanOrEqual(HEADER_PX);
      expect(box.bottom, `#${anchor} below the fold`).toBeLessThanOrEqual(box.viewport);
      // The rail went along.
      const rail = await toc.boundingBox();
      expect(rail && rail.y >= HEADER_PX && rail.y < box.viewport).toBe(true);
    }
  });
}

test("a link from outside to a section opens the page at that section", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/terms#fair-use");
  await expect.poll(async () => (await headingBox(page, "fair-use")).top).toBeGreaterThanOrEqual(HEADER_PX);
  const box = await headingBox(page, "fair-use");
  expect(box.bottom).toBeLessThanOrEqual(box.viewport);
  expect(box.top).toBeLessThan(box.viewport / 2);
});

test("on a phone the contents are a plain list before the text, and the links still land", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/privacy");
  const toc = page.getByRole("navigation", { name: t("legal:nav.toc") });
  await expect(toc).toBeVisible();
  // Not a rail: it scrolls away with the page, and it comes before the first section.
  expect(await toc.evaluate((nav) => getComputedStyle(nav.parentElement!).position)).toBe("static");
  expect(await toc.evaluate((nav) => Boolean(nav.compareDocumentPosition(document.getElementById("responsible")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  // The footer, right under the text, has the legal pages; the rail's copy of them is a desktop thing.
  await expect(page.getByRole("navigation", { name: t("legal:nav.label") })).toBeHidden();
  await toc.locator('a[href="#cookies"]').click();
  const box = await headingBox(page, "cookies");
  expect(box.top).toBeGreaterThanOrEqual(HEADER_PX);
  expect(box.bottom).toBeLessThanOrEqual(box.viewport);
});

