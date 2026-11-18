import { CV_LINES, REQUIREMENT_IDS, type RequirementId } from "@/screens/Home/utils/exampleCase";
import { PROOFS, STEP_IDS, type StepId } from "./storyData";

// Where every item of the story's object sits at each step, on a large screen. x and w are percentages of the
// object's width, y and h are pixels; the stage moves each item from one step's box to the next. Pure: no DOM.

export const PAD = 20;
export const GAP = 6;
/** The CV sheet's header and row heights: the stage draws the sheet with these, the wires aim at them. */
export const CV_HEAD = 40;
export const CV_ROW = 32;
/** Where a requirement row's first line sits, measured from the row's top. */
const ROW_TEXT_Y = 19;

export const ITEM_KEYS = ["bar", "intro", "h0", "h1", "h2", ...REQUIREMENT_IDS, "extra", "cv", "tally", "outcomes", "after"] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];

export type Box = { x: number; w: number; y: number; h: number; on: boolean };
export type Layout = { boxes: Record<ItemKey, Box>; height: number };

export const isRequirement = (key: ItemKey): key is RequirementId => (REQUIREMENT_IDS as readonly string[]).includes(key);

/** Stacks items top to bottom in the given order and heights, from `top`, in the column [x, x + w]. */
export function stack(order: readonly (readonly [ItemKey, number])[], x = 0, w = 100, top = PAD) {
  const boxes: Partial<Record<ItemKey, Box>> = {};
  let y = top;
  for (const [key, h] of order) {
    boxes[key] = { x, w, y, h, on: true };
    y += h + GAP;
  }
  return { boxes, bottom: y - GAP };
}

/** The items a step shows and where; everything else fades out where it was (or where it will first appear). */
export function layoutFor(step: StepId, prev: Layout | null): Layout {
  let placed: Partial<Record<ItemKey, Box>>;
  let bottom: number;
  switch (step) {
    case "posting":
    case "requirements": {
      // The posting as it reads: its company blurb, its two headings, its six lines, then the CV file.
      const s = stack([
        ["bar", 46],
        ["intro", step === "requirements" ? 56 : 38],
        ["h0", 30],
        ["r1", 38],
        ["r2", 38],
        ["r3", 38],
        ["r4", 38],
        ["h1", 30],
        ["r5", 38],
        ["r6", 38],
        ["cv", 52],
      ]);
      ({ boxes: placed, bottom } = s);
      break;
    }
    case "search": {
      // Requirements on the left, the CV sheet on the right, level with them; the bar spans both.
      const left = stack(
        [
          ["bar", 40],
          ["r1", 100],
          ["r2", 56],
          ["r3", 110],
          ["r4", 56],
          ["r5", 56],
          ["r6", 56],
        ],
        0,
        40,
      );
      placed = left.boxes;
      placed.bar = { ...placed.bar!, w: 100 };
      const cvTop = PAD + 40 + GAP;
      const cvH = CV_HEAD + CV_LINES.length * CV_ROW + 12;
      placed.cv = { x: 48, w: 52, y: cvTop, h: cvH, on: true };
      bottom = Math.max(left.bottom, cvTop + cvH);
      break;
    }
    case "verdict": {
      const s = stack([
        ["bar", 40],
        ["h0", 30],
        ["r1", 44],
        ["r2", 44],
        ["r3", 44],
        ["r4", 44],
        ["h1", 30],
        ["r5", 44],
        ["r6", 44],
        ["tally", 104],
      ]);
      ({ boxes: placed, bottom } = s);
      break;
    }
    case "interview": {
      // The interviewer's agenda: what's open first, then what's met, then what the CV can't show.
      const s = stack([
        ["bar", 48],
        ["h0", 30],
        ["r3", 44],
        ["r5", 44],
        ["h1", 30],
        ["r1", 44],
        ["r2", 44],
        ["r6", 44],
        ["h2", 30],
        ["r4", 44],
        ["extra", 50],
      ]);
      ({ boxes: placed, bottom } = s);
      break;
    }
    case "feedback": {
      const s = stack([
        ["bar", 44],
        ["r3", 96],
        ["r5", 96],
        ["outcomes", 44],
        ["after", 96],
      ]);
      ({ boxes: placed, bottom } = s);
      break;
    }
  }
  const boxes = {} as Record<ItemKey, Box>;
  for (const key of ITEM_KEYS) {
    const box = placed[key];
    const was = prev?.boxes[key];
    boxes[key] = box ?? (was ? { ...was, on: false } : { x: 0, w: 100, y: PAD, h: 0, on: false });
  }
  return { boxes, height: bottom + PAD };
}

/** Every step's layout in order; an item hidden before it first appears already rests at its first place. */
export function allLayouts(): Layout[] {
  const out: Layout[] = [];
  let prev: Layout | null = null;
  for (const step of STEP_IDS) {
    prev = layoutFor(step, prev);
    out.push(prev);
  }
  for (const key of ITEM_KEYS) {
    const first = out.find((l) => l.boxes[key].on)?.boxes[key];
    if (!first) continue;
    for (const l of out) {
      if (l.boxes[key].on) break;
      l.boxes[key] = { ...first, on: false };
    }
  }
  return out;
}

export const STORY_LAYOUTS: readonly Layout[] = allLayouts();

export const layoutOf = (step: StepId) => STORY_LAYOUTS[STEP_IDS.indexOf(step)];

/** The search step's wires: from each proven requirement's row to its line on the CV sheet (x in %, y in px). */
export function wirePaths(layout: Layout = layoutOf("search")) {
  const cv = layout.boxes.cv;
  return PROOFS.map((proof) => {
    const row = layout.boxes[proof.id];
    const y0 = row.y + ROW_TEXT_Y;
    const y1 = cv.y + CV_HEAD + (proof.line - 1) * CV_ROW + CV_ROW / 2;
    const x0 = row.x + row.w;
    const x1 = cv.x;
    return { id: proof.id, partial: proof.partial, d: `M ${x0} ${y0} C ${x0 + 4.5} ${y0}, ${x1 - 4.5} ${y1}, ${x1} ${y1}` };
  });
}

/** A still figure's items top to bottom: the step's layout in reading order. The search step writes each proof
 * under its row instead of drawing the CV sheet beside them, which a phone has no room for. */
export function stillOrder(step: StepId): ItemKey[] {
  const { boxes } = layoutOf(step);
  return ITEM_KEYS.filter((key) => boxes[key].on && !(step === "search" && key === "cv")).sort((a, b) => boxes[a].y - boxes[b].y);
}
