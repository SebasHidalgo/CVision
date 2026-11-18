import { describe, expect, it } from "vitest";
import { BOOT_SCRIPT, LOADER_CAP_MS, REVEALED_EVENT } from "./bootScript";

/** Runs the boot script against a stand-in document at a path; returns what it set and its timers. */
function boot(pathname: string) {
  const attributes = new Map<string, string>();
  const style: Record<string, string> = {};
  const timers: { fn: () => void; ms: number }[] = [];
  const events: string[] = [];
  const marks: string[] = [];
  const element = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    removeAttribute: (name: string) => attributes.delete(name),
    style,
  };
  const win: Record<string, unknown> = { dispatchEvent: (e: Event) => events.push(e.type) };
  const run = new Function("document", "location", "window", "setTimeout", "performance", "Event", BOOT_SCRIPT);
  run({ documentElement: element }, { pathname }, win, (fn: () => void, ms: number) => timers.push({ fn, ms }), { mark: (n: string) => marks.push(n) }, Event);
  return { attributes, style, timers, events, marks, reveal: win.__cvReveal as (() => void) | undefined };
}

describe("the boot script", () => {
  it("marks JavaScript on every page and raises the loader only on the landing", () => {
    const other = boot("/pricing");
    expect(other.attributes.has("data-js")).toBe(true);
    expect(other.attributes.has("data-loading")).toBe(false);
    expect(other.timers).toEqual([]);

    const landing = boot("/");
    expect(landing.attributes.has("data-js")).toBe(true);
    expect(landing.attributes.get("data-loading")).toBe("");
    expect(landing.style.overflow).toBe("hidden");
    expect(landing.timers.map((t) => t.ms)).toEqual([LOADER_CAP_MS]);
  });

  it("shows the page at the cap, once", () => {
    const landing = boot("/");
    landing.timers[0].fn();
    expect(landing.attributes.has("data-loading")).toBe(false);
    expect(landing.style.overflow).toBe("");
    expect(landing.events).toEqual([REVEALED_EVENT]);
    expect(landing.marks).toEqual([REVEALED_EVENT]);
    landing.reveal?.();
    expect(landing.events).toHaveLength(1);
  });

  it("lets a hand-over in progress finish past the cap", () => {
    const landing = boot("/");
    landing.attributes.set("data-loading", "travel");
    landing.timers[0].fn();
    expect(landing.attributes.get("data-loading")).toBe("travel");
    landing.reveal?.();
    expect(landing.attributes.has("data-loading")).toBe(false);
  });
});
