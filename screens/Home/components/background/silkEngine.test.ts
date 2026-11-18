import { describe, expect, it } from "vitest";
import { CANVAS, CEIL, maxLuminance, relativeLuminance } from "./silkEngine";

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

describe("the silk ground's light", () => {
  it("leaves the page's dimmest open-page text (ink-2) at AA on its brightest pixel", () => {
    const ink2 = relativeLuminance(...hex("#A3A6AD"));
    expect(contrast(ink2, relativeLuminance(...CEIL))).toBeGreaterThanOrEqual(4.5);
  });

  it("starts from the page's canvas colour", () => {
    expect(CANVAS).toEqual(hex("#0C0D0F"));
  });

  it("reads the brightest pixel of a buffer", () => {
    const px = new Uint8Array([...CANVAS, 255, ...CEIL, 255, 20, 20, 20, 255]);
    expect(maxLuminance(px)).toBeCloseTo(relativeLuminance(...CEIL), 10);
  });
});
