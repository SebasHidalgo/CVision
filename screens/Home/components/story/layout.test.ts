import { describe, expect, it } from "vitest";
import { allLayouts, CV_HEAD, CV_ROW, GAP, ITEM_KEYS, layoutOf, PAD, stack, stillOrder, wirePaths } from "./layout";
import { clock, exampleTally, STEP_IDS } from "./storyData";

describe("the story's layout", () => {
  it("stacks items with one gap between them", () => {
    const { boxes, bottom } = stack([
      ["bar", 40],
      ["r1", 30],
    ]);
    expect(boxes.bar).toEqual({ x: 0, w: 100, y: PAD, h: 40, on: true });
    expect(boxes.r1?.y).toBe(PAD + 40 + GAP);
    expect(bottom).toBe(PAD + 40 + GAP + 30);
  });

  it("places every item at every step, with the bar always on", () => {
    const layouts = allLayouts();
    expect(layouts).toHaveLength(STEP_IDS.length);
    for (const layout of layouts) {
      expect(Object.keys(layout.boxes).sort()).toEqual([...ITEM_KEYS].sort());
      expect(layout.boxes.bar.on).toBe(true);
    }
  });

  it("keeps a hidden item where it was, and an item not yet shown where it will appear", () => {
    // The company blurb leaves after the requirements step and stays put, faded.
    expect(layoutOf("search").boxes.intro).toEqual({ ...layoutOf("requirements").boxes.intro, on: false });
    // The tally first shows at the verdict step; before that it waits at that same box.
    expect(layoutOf("posting").boxes.tally).toEqual({ ...layoutOf("verdict").boxes.tally, on: false });
  });

  it("sets the CV sheet beside the requirements at the search step", () => {
    const { boxes } = layoutOf("search");
    expect(boxes.cv).toMatchObject({ x: 48, w: 52, on: true });
    expect(boxes.r1).toMatchObject({ x: 0, w: 40 });
    expect(boxes.bar.w).toBe(100);
  });

  it("orders the interview's agenda: gaps, then what's met, then what the CV can't show", () => {
    const order = stillOrder("interview").filter((key) => /^r\d$/.test(key));
    expect(order).toEqual(["r3", "r5", "r1", "r2", "r6", "r4"]);
  });

  it("fits every step in the sticky frame of a 1280x720 screen", () => {
    // 720 - 88 (header and margins) - 50 (the index) - 12 (gap): what the object has at that height.
    for (const layout of allLayouts()) expect(layout.height).toBeLessThanOrEqual(570);
  });

  it("wires each proven requirement to its CV line", () => {
    const wires = wirePaths();
    expect(wires.map((w) => w.id)).toEqual(["r1", "r2", "r3", "r6"]);
    expect(wires.find((w) => w.id === "r3")?.partial).toBe(true);
    const { cv } = layoutOf("search").boxes;
    const r2 = wires.find((w) => w.id === "r2")!;
    // Line 6 of the sheet, from the requirement column's right edge to the sheet's left edge.
    expect(r2.d.startsWith("M 40 ")).toBe(true);
    expect(r2.d.endsWith(`48 ${cv.y + CV_HEAD + 5 * CV_ROW + CV_ROW / 2}`)).toBe(true);
  });

  it("leaves the CV sheet out of the search step's still", () => {
    expect(stillOrder("search")).toEqual(["bar", "r1", "r2", "r3", "r4", "r5", "r6"]);
    expect(stillOrder("posting").at(-1)).toBe("cv");
  });
});

describe("the story's data", () => {
  it("counts the example as the analysis page would", () => {
    expect(exampleTally()).toEqual({
      required: { met: 2, partial: 1, total: 3 },
      preferred: { met: 1, partial: 0, total: 2 },
      notShown: 1,
    });
  });

  it("prints call times as m:ss", () => {
    expect(clock(58)).toBe("0:58");
    expect(clock(81)).toBe("1:21");
    expect(clock(720)).toBe("12:00");
  });
});
