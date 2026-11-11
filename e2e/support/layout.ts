import type { Page } from "@playwright/test";

/**
 * Layout checks the eye would make, run in the page: the page never scrolls sideways, no text
 * overlaps a button, and no button clips or spills its own text. Boxes come from the rendered glyphs
 * (text ranges), not from block boxes, so a paragraph beside a button only counts when the words
 * themselves touch it. Hidden and aria-hidden elements are skipped, and a sticky bar is compared with
 * its own contents only (content scrolls under it by design).
 */

export type LayoutViolation = { page: string; width: number; kind: "horizontal-scroll" | "overlap" | "clipped"; detail: string };

/** The whole document at the current viewport. Call at the top of the page, after it settled. */
export async function layoutViolations(page: Page, label: string): Promise<LayoutViolation[]> {
  const width = page.viewportSize()?.width ?? 0;
  const found = await page.evaluate(() => {
    const out: Array<{ kind: "horizontal-scroll" | "overlap" | "clipped"; detail: string }> = [];
    const TOLERANCE = 2;
    const shown = (el: Element) => {
      if (el.closest('[aria-hidden="true"], [hidden], .sr-only, script, style, noscript, template')) return false;
      for (let at: Element | null = el; at; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const describe = (el: Element) => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      const name = el.getAttribute("aria-label");
      return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}> ${JSON.stringify(name ?? text)}`;
    };
    const textRects = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5);
    };
    const meets = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOLERANCE && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOLERANCE;

    // 1. Sideways scroll, and what sticks out.
    const viewport = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > viewport + 1) {
      const wide = [...document.body.querySelectorAll("*")]
        .filter((el) => shown(el) && el.getBoundingClientRect().right > viewport + 1)
        .filter((el) => ![...el.children].some((child) => child.getBoundingClientRect().right > viewport + 1))
        .slice(0, 4)
        .map(describe);
      out.push({ kind: "horizontal-scroll", detail: `scrollWidth ${document.documentElement.scrollWidth} > ${viewport}: ${wide.join("; ")}` });
    }

    // 2. Text overlapping a button that does not contain it.
    const buttons = [...document.querySelectorAll('button, [role="button"], [data-slot="button"]')].filter(shown);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: Array<{ node: Node; owner: Element; rects: DOMRect[] }> = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement;
      if (!owner || !(node.textContent ?? "").trim() || !shown(owner)) continue;
      if (owner.closest('button, [role="button"], [data-slot="button"]')) continue;
      texts.push({ node, owner, rects: textRects(node) });
    }
    // A sticky or fixed bar floats over the content scrolling under it by design: compare within one layer only.
    const layer = (el: Element) => {
      for (let at: Element | null = el; at; at = at.parentElement) {
        const position = getComputedStyle(at).position;
        if (position === "sticky" || position === "fixed") return at;
      }
      return null;
    };
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      const buttonLayer = layer(button);
      for (const text of texts) {
        if (button.contains(text.owner) || layer(text.owner) !== buttonLayer) continue;
        if (text.rects.some((rect) => meets(rect, box))) {
          out.push({ kind: "overlap", detail: `${describe(text.owner)} overlaps ${describe(button)}` });
          break;
        }
      }
    }

    // 3. A button's own text cut off or spilling out of it.
    for (const button of buttons) {
      if (!(button.textContent ?? "").trim()) continue;
      const box = button.getBoundingClientRect();
      const spills = textRects(button).some((rect) => rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1);
      const truncated = [button, ...button.querySelectorAll("*")].some(
        (el) => el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible",
      );
      if (spills || truncated) out.push({ kind: "clipped", detail: `${describe(button)}${truncated ? " (truncated)" : " (text outside the button)"}` });
    }
    return out;
  });
  return found.map((violation) => ({ page: label, width, ...violation }));
}

/** Waits until the page is still: fonts loaded, no translation skeleton left, the network quiet. */
export async function settle(page: Page, { skeletonTimeoutMs = 60_000 } = {}): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForFunction(() => !document.querySelector("[data-prose-pending]"), undefined, { timeout: skeletonTimeoutMs });
  await page.evaluate(() => window.scrollTo(0, 0));
}
