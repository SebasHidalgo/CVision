// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/locales/en/common.json";
import TranslationPending from "./TranslationPending";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/resume/analysis/a1" }));
vi.mock("next/link", () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("TranslationPending", () => {
  it("says it is translating, calls the action once, then refreshes", async () => {
    const translate = vi.fn(async () => ({ ok: true as const, data: { outcome: "ready" } }));
    const { rerender } = render(<TranslationPending translate={translate} input={{ resumeId: "a1" }} />);
    expect(screen.getByRole("status").textContent).toContain(en.translation.pending);
    rerender(<TranslationPending translate={translate} input={{ resumeId: "a1" }} />);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith({ resumeId: "a1" });
  });

  it("refreshes after a refused translation too: the server then shows the original with its notice", async () => {
    const translate = vi.fn(async () => ({ ok: false as const, code: "RATE_LIMITED" as const }));
    render(<TranslationPending translate={translate} input={{ resumeId: "a1" }} />);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("offers the original instead of looping when the call never reached the server", async () => {
    const translate = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(<TranslationPending translate={translate} input={{ resumeId: "a1" }} />);
    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("/resume/analysis/a1?original=1");
    expect(screen.getByRole("status").textContent).toContain("Translation unavailable; showing the original.");
    expect(refresh).not.toHaveBeenCalled();
    // A 44 px target, and the mark holds still: nothing is running any more.
    expect(link.className).toContain("min-h-11");
    expect(screen.getByRole("status").querySelector("[data-status-mark]")?.className).not.toMatch(/animate-pulse/);
  });

  it("is drawn in the design system: body text in ink-2, an ink mark that pulses only when motion is allowed", () => {
    const translate = vi.fn(() => new Promise<never>(() => {}));
    render(<TranslationPending translate={translate} input={{ resumeId: "a1" }} className="mt-10" />);
    const line = screen.getByRole("status");
    expect(line.className).toMatch(/\btext-ed-body\b/);
    expect(line.className).toMatch(/\btext-ed-ink-2\b/);
    expect(line.className).toMatch(/\bmt-10\b/);
    const mark = line.querySelector("[data-status-mark]");
    expect(mark?.className).toMatch(/\bbg-ed-ink-2\b/);
    expect(mark?.className).toMatch(/\bmotion-safe:animate-pulse\b/);
    // Green marks what a CV proves; the old light system's tokens are gone.
    expect(line.outerHTML).not.toMatch(/signal|eyebrow|text-ink-|bg-fair|bg-paper/);
  });
});
