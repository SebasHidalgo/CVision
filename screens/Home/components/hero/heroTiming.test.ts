import { describe, expect, it } from "vitest";
import { REQUIREMENTS } from "@/screens/Home/utils/exampleCase";
import { LATE_STEP, proves, SETTLED, startTimes, T_REST, T_SCAN0, T_SCAN1 } from "./heroTiming";
import { wirePath } from "./wires";

describe("the hero's reading", () => {
  const starts = startTimes();

  it("lands each proven requirement when the scan reaches its CV line, in line order", () => {
    const proven = REQUIREMENTS.map((r, i) => ({ r, t: starts[i] })).filter(({ r }) => proves(r));
    expect(proven.length).toBeGreaterThan(0);
    for (const { t } of proven) {
      expect(t).toBeGreaterThanOrEqual(T_SCAN0);
      expect(t).toBeLessThanOrEqual(T_SCAN1);
    }
    const byLine = [...proven].sort((a, b) => (a.r.line ?? 0) - (b.r.line ?? 0)).map(({ t }) => t);
    expect(byLine).toEqual([...byLine].sort((a, b) => a - b));
  });

  it("files the unproven ones after the scan, one step apart, and settles after the last", () => {
    const late = REQUIREMENTS.map((r, i) => ({ r, t: starts[i] })).filter(({ r }) => !proves(r)).map(({ t }) => t);
    expect(late).toEqual(late.map((_, k) => T_REST + k * LATE_STEP));
    expect(SETTLED).toBeGreaterThan(Math.max(...starts));
  });
});

describe("wirePath", () => {
  const origin = { left: 100, top: 50 };
  const row = { left: 140, right: 400, top: 80, bottom: 100 };
  const line = { left: 140, right: 400, top: 300, bottom: 320 };

  it("bows into the left gutter when the sheets are stacked", () => {
    const sheet = { left: 124, right: 424, top: 60, bottom: 260 };
    const cv = { left: 124, right: 424, top: 280, bottom: 500 };
    expect(wirePath(origin, sheet, cv, row, line)).toBe("M 23.0 260.0 C 5.0 260.0, 5.0 40.0, 23.0 40.0");
  });

  it("crosses the gap when the CV sits to the right", () => {
    const sheet = { left: 100, right: 400, top: 60, bottom: 260 };
    const cv = { left: 500, right: 800, top: 60, bottom: 260 };
    expect(wirePath(origin, sheet, cv, row, line)).toBe("M 399.0 260.0 C 350.0 260.0, 350.0 40.0, 301.0 40.0");
  });
});
