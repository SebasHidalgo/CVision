import type { Page } from "@playwright/test";

/**
 * Layout checks the eye would make, run in the page: the page never scrolls sideways, no text runs
 * over or under something it does not belong to (a button, a card, an image, an illustration, other
 * text), no text leaves its own block sideways, and no button clips or spills its label. Boxes come
 * from the rendered glyphs (text ranges), not from block boxes, so a paragraph beside a card only
 * counts when the words themselves touch it. Hidden, aria-hidden and clipped-away text is skipped, and a
 * sticky bar is compared with its own contents only (content scrolls under it by design).
 */

export type LayoutKind = "horizontal-scroll" | "overlap" | "overflow" | "clipped";
export type LayoutViolation = { page: string; width: number; kind: LayoutKind; detail: string };

/** The whole document at the current viewport. Call at the top of the page, after it settled. */
export async function layoutViolations(page: Page, label: string): Promise<LayoutViolation[]> {
  const width = page.viewportSize()?.width ?? 0;
  const found = await page.evaluate(() => {
    type Kind = "horizontal-scroll" | "overlap" | "overflow" | "clipped";
    const out: Array<{ kind: Kind; detail: string }> = [];
    const TOLERANCE = 2;
    const BUTTON = 'button, [role="button"], [data-slot="button"]';
    const styles = new Map<Element, CSSStyleDeclaration>();
    const styleOf = (el: Element) => {
      let style = styles.get(el);
      if (!style) styles.set(el, (style = getComputedStyle(el)));
      return style;
    };
    const visibility = new Map<Element, boolean>();
    const visible = (el: Element): boolean => {
      const known = visibility.get(el);
      if (known !== undefined) return known;
      const style = styleOf(el);
      const self = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
      const result = self && (el.parentElement ? visible(el.parentElement) : true);
      visibility.set(el, result);
      return result;
    };
    const shown = (el: Element) => {
      if (el.closest('[aria-hidden="true"], [hidden], .sr-only, script, style, noscript, template')) return false;
      if (!visible(el)) return false;
      // A closed <details> keeps its content measurable but does not render it.
      if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
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
    const inside = (a: DOMRect, b: DOMRect) =>
      a.left >= b.left - TOLERANCE && a.right <= b.right + TOLERANCE && a.top >= b.top - TOLERANCE && a.bottom <= b.bottom + TOLERANCE;
    // A sticky or fixed bar floats over the content scrolling under it by design: compare within one layer only.
    const layers = new Map<Element, Element | null>();
    const layer = (el: Element): Element | null => {
      if (layers.has(el)) return layers.get(el) ?? null;
      const position = styleOf(el).position;
      const result = position === "sticky" || position === "fixed" ? el : el.parentElement ? layer(el.parentElement) : null;
      layers.set(el, result);
      return result;
    };
    // The nearest ancestor that lays text out in lines.
    const block = (el: Element): Element => {
      for (let at: Element | null = el; at; at = at.parentElement) {
        const display = styleOf(at).display;
        if (display !== "inline" && display !== "contents") return at;
      }
      return document.body;
    };

    // The block whose lines the text sits in: inline-blocks on tight lines share it.
    const flow = (el: Element): Element => {
      for (let at: Element | null = el; at; at = at.parentElement) {
        const display = styleOf(at).display;
        if (!display.startsWith("inline") && display !== "contents") return at;
      }
      return document.body;
    };

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

    // What an ancestor that clips (a closed accordion, a scroller, a line clamp) leaves of each box.
    const clipped = (rects: DOMRect[], owner: Element): DOMRect[] => {
      let left = -Infinity;
      let top = -Infinity;
      let right = Infinity;
      let bottom = Infinity;
      for (let at: Element | null = owner; at && at !== document.body; at = at.parentElement) {
        const style = styleOf(at);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const box = at.getBoundingClientRect();
        if (style.overflowX !== "visible") {
          left = Math.max(left, box.left);
          right = Math.min(right, box.right);
        }
        if (style.overflowY !== "visible") {
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      return rects
        .map((rect) => new DOMRect(Math.max(rect.left, left), Math.max(rect.top, top), Math.min(rect.right, right) - Math.max(rect.left, left), Math.min(rect.bottom, bottom) - Math.max(rect.top, top)))
        .filter((rect) => rect.width > 0.5 && rect.height > 0.5);
    };

    // Every visible text node with its glyph boxes.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: Array<{ owner: Element; rects: DOMRect[]; block: Element; flow: Element }> = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement;
      if (!owner || !(node.textContent ?? "").trim() || !shown(owner)) continue;
      const rects = clipped(textRects(node), owner);
      if (rects.length) texts.push({ owner, rects, block: block(owner), flow: flow(owner) });
    }

    // Things that paint: a filled or framed box, a shadow, an image, a control.
    const PAINTED = new Set(["img", "svg", "canvas", "video", "input", "textarea", "select", "button"]);
    const clear = (color: string) => color === "transparent" || /[,/]\s*0\)$/.test(color);
    const paints = (el: Element) => {
      if (PAINTED.has(el.tagName.toLowerCase()) || el.matches(BUTTON)) return true;
      const style = styleOf(el);
      if (!clear(style.backgroundColor) || style.backgroundImage !== "none" || style.boxShadow !== "none") return true;
      const sides = ["top", "right", "bottom", "left"].filter((side) => parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0);
      return sides.length >= 3;
    };
    const obstacles = [...document.body.querySelectorAll("*")]
      .filter((el) => el.tagName.toLowerCase() === "svg" || !el.closest("svg"))
      .filter((el) => shown(el) && paints(el))
      .map((el) => ({ el, box: el.getBoundingClientRect(), layer: layer(el) }));
    const onTop = (rect: DOMRect, el: Element, owner: Element) => {
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return !!hit && (el === hit || el.contains(hit)) && !owner.contains(hit);
    };

    const reported = new Set<string>();
    const report = (kind: Kind, detail: string) => {
      if (reported.has(detail)) return;
      reported.add(detail);
      out.push({ kind, detail });
    };

    // 2. Text against a painted element that neither holds it nor sits inside it.
    for (const text of texts) {
      const textLayer = layer(text.owner);
      for (const obstacle of obstacles) {
        if (obstacle.layer !== textLayer || obstacle.el.contains(text.owner) || text.owner.contains(obstacle.el)) continue;
        for (const rect of text.rects) {
          if (!meets(rect, obstacle.box)) continue;
          // Words wholly inside a box painted under them sit on a backdrop; anything else collides.
          if (inside(rect, obstacle.box) && !onTop(rect, obstacle.el, text.owner)) continue;
          report("overlap", `${describe(text.owner)} overlaps ${describe(obstacle.el)}`);
          break;
        }
      }
    }

    // 3. Text against the text of another block.
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i];
        const b = texts[j];
        if (a.owner.closest(BUTTON) || b.owner.closest(BUTTON)) continue;
        if (a.flow === b.flow || a.flow.contains(b.flow) || b.flow.contains(a.flow) || layer(a.owner) !== layer(b.owner)) continue;
        if (a.rects.some((ra) => b.rects.some((rb) => meets(ra, rb)))) report("overlap", `${describe(a.owner)} overlaps the text ${describe(b.owner)}`);
      }
    }

    // 4. Text leaving its own block sideways (a scroller or an ellipsis is deliberate).
    for (const text of texts) {
      let deliberate = false;
      for (let at: Element | null = text.owner; at && at !== document.body; at = at.parentElement) {
        const style = styleOf(at);
        if (style.overflowX === "auto" || style.overflowX === "scroll" || style.textOverflow === "ellipsis") deliberate = true;
      }
      if (deliberate || text.owner.closest(BUTTON)) continue;
      // Every in-flow ancestor counts: a nowrap inline-block holds its own words and still leaves its column.
      for (let at: Element | null = text.block; at && at !== document.body; at = at.parentElement) {
        const style = styleOf(at);
        if (style.display === "inline" || style.display === "contents") continue;
        const box = at.getBoundingClientRect();
        const stray = text.rects.find((rect) => rect.right > box.right + TOLERANCE || rect.left < box.left - TOLERANCE);
        if (stray) {
          const by = Math.round(Math.max(stray.right - box.right, box.left - stray.left));
          report("overflow", `${describe(text.owner)} leaves its block ${describe(at)} by ${by}px`);
          break;
        }
        if (style.position === "absolute" || style.position === "fixed") break;
      }
    }

    // 5. A button's own text cut off or spilling out of it.
    for (const button of [...document.querySelectorAll(BUTTON)].filter(shown)) {
      if (!(button.textContent ?? "").trim()) continue;
      const box = button.getBoundingClientRect();
      const spills = textRects(button).some((rect) => rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1);
      const truncated = [button, ...button.querySelectorAll("*")].some(
        (el) => el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible",
      );
      if (spills || truncated) report("clipped", `${describe(button)}${truncated ? " (truncated)" : " (text outside the button)"}`);
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
