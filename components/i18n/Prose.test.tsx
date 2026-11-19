// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PENDING_PROSE } from "@/lib/i18n/analysisView";
import Prose from "./Prose";

afterEach(cleanup);

describe("Prose", () => {
  it("renders the prose itself, with no wrapper", () => {
    const { container } = render(<Prose text="Lead with the migration." />);
    expect(container.innerHTML).toBe("Lead with the migration.");
  });

  it("draws one skeleton bar per line while the translation is on its way, hidden from assistive tech", () => {
    const { container } = render(<Prose text={PENDING_PROSE} lines={3} className="w-2/3" />);
    const skeleton = container.querySelector("[data-prose-pending]");
    expect(skeleton?.getAttribute("aria-hidden")).toBe("true");
    expect(skeleton?.className).toMatch(/\bw-2\/3\b/);
    const bars = [...(skeleton?.children ?? [])];
    expect(bars).toHaveLength(3);
    expect(bars.at(-1)?.className).toMatch(/\bw-3\/5\b/);
  });

  it("draws the bars on the design system's edge colour, pulsing only when motion is allowed", () => {
    const { container } = render(<Prose text={PENDING_PROSE} lines={1} />);
    const [bar] = [...(container.querySelector("[data-prose-pending]")?.children ?? [])];
    expect(bar.className).toMatch(/\bbg-ed-line-2\b/);
    expect(bar.className).toMatch(/\bmotion-safe:animate-pulse\b/);
    expect(bar.className).toMatch(/\bw-full\b/);
    expect(bar.className).not.toMatch(/bg-paper/);
  });
});
