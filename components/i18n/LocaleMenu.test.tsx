// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import LocaleMenu from "./LocaleMenu";

const switchTo = vi.fn();
const prefetch = vi.fn();
vi.mock("@/hooks/useLocaleSwitch", () => ({
  useLocaleSwitch: () => ({ current: "en", pending: null, switchTo, prefetch }),
}));

beforeAll(() => {
  // Radix positions the menu with a ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const open = () => {
  const trigger = screen.getByRole("button", { name: "EN, language: English" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
};

describe("LocaleMenu", () => {
  it("names the current language on its button", () => {
    render(<LocaleMenu />);
    const trigger = screen.getByRole("button", { name: "EN, language: English" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.textContent).toBe("en");
  });

  it("lists every language in its own language, the current one checked", () => {
    render(<LocaleMenu />);
    open();
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => [item.textContent, item.getAttribute("lang"), item.getAttribute("aria-checked")])).toEqual([
      ["English", "en", "true"],
      ["Español", "es", "false"],
    ]);
  });

  it("fetches the other language's strings when it opens, and switches on a choice", () => {
    render(<LocaleMenu />);
    open();
    expect(prefetch).toHaveBeenCalledWith("es");
    expect(prefetch).not.toHaveBeenCalledWith("en");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Español" }));
    expect(switchTo).toHaveBeenCalledExactlyOnceWith("es");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the language's full name in the settings variant", () => {
    render(<LocaleMenu variant="full" />);
    expect(screen.getByRole("button", { name: "EN, language: English" }).textContent).toBe("English");
  });
});
