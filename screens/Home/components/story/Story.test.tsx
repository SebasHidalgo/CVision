// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import I18nProvider from "@/components/providers/I18nProvider";
import type { Locale } from "@/lib/i18n/config";
import { pickResources } from "@/lib/i18n/resources";
import { Story } from "./Story";

// Vite can't load the project's PostCSS config, so a CSS module never reaches the test: class names stand in.
vi.mock("./Story.module.css", () => ({ default: new Proxy({}, { get: (_, name) => String(name) }) }));

beforeEach(() => {
  // jsdom has none of these: the section only needs them to exist.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

const mount = (locale: Locale) =>
  render(
    <I18nProvider locale={locale} resources={pickResources(locale, ["common", "landing", "landingStory"])}>
      <Story />
    </I18nProvider>,
  );

describe("the story section", () => {
  it.each(["en", "es"] as const)("renders every step and figure without a missing string (%s)", (locale) => {
    const { container } = mount(locale);
    const section = container.querySelector("section#how-it-works")!;
    expect(section.getAttribute("aria-labelledby")).toBe("how-it-works-title");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(6);
    // A missing key renders as the key itself.
    expect(section.textContent).not.toMatch(/\b(?:figure|steps|case|rail|score)\.[a-z]/);
    expect(section.textContent).toContain(locale === "en" ? "Partial fit" : "Compatibilidad parcial");
    expect(section.textContent).toContain(locale === "en" ? "“Not AWS." : "«No en AWS.");
  });

  it("jumps to a step from the index and moves focus to its heading", () => {
    mount("en");
    const index = screen.getByRole("navigation", { name: "How it works, step by step" });
    const verdict = within(index).getByRole("button", { name: /Four statuses and a count/ });
    fireEvent.click(verdict);
    expect(verdict.getAttribute("aria-current")).toBe("step");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 3, name: "Four statuses and a count" }));
    // The steps before it read as done.
    expect(within(index).getAllByRole("button").filter((b) => b.hasAttribute("data-done"))).toHaveLength(3);
  });
});
