// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVEALED_EVENT } from "@/lib/bootScript";
import { readySignals } from "@/screens/Home/utils/readiness";
import { Hero } from "./Hero";

// Clerk is not under test: the start action is a plain button here.
vi.mock("@/screens/Home/components/StartCta", () => ({ StartCta: ({ label }: { label: string }) => <button type="button">{label}</button> }));
// jsdom has no WebGL: each test says whether the device has a hardware GPU.
let gpu = false;
vi.mock("@/screens/Home/components/background/gpu", () => ({ hasHardwareWebGL: () => gpu }));
// The real scene needs WebGL; a canvas that reports its first frame stands in for it.
vi.mock("./scene/HeroScene", () => ({
  HeroScene: ({ onFirstFrame }: { onFirstFrame: () => void }) => {
    useEffect(() => onFirstFrame(), [onFirstFrame]);
    return <canvas data-testid="scene" />;
  },
}));

let wide = false;
let reduced = false;

beforeEach(() => {
  gpu = false;
  wide = false;
  reduced = false;
  delete window.__cvReady;
  document.documentElement.removeAttribute("data-loading");
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reduced : query.includes("min-width") ? wide : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // jsdom has no WAAPI: the scan line is a no-op here.
  Element.prototype.animate = () => ({ cancel() {} }) as unknown as Animation;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const pending = (container: HTMLElement) => container.querySelectorAll("button[data-req][data-pending]").length;
const flush = () => act(async () => void (await Promise.resolve()));

describe("Hero", () => {
  it("holds its reading while the loader is up and plays it on the reveal", async () => {
    document.documentElement.setAttribute("data-loading", "");
    const { container } = render(<Hero />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(pending(container)).toBe(6);

    act(() => void window.dispatchEvent(new Event(REVEALED_EVENT)));
    act(() => void vi.advanceTimersByTime(2_000));
    expect(pending(container)).toBeGreaterThan(0);
    expect(pending(container)).toBeLessThan(6);
    act(() => void vi.advanceTimersByTime(4_000));
    expect(pending(container)).toBe(0);
  });

  it("starts when the loader's attribute goes away, even without the event", async () => {
    document.documentElement.setAttribute("data-loading", "travel");
    const { container } = render(<Hero />);
    document.documentElement.removeAttribute("data-loading");
    await flush();
    act(() => void vi.advanceTimersByTime(6_000));
    expect(pending(container)).toBe(0);
  });

  it("plays at once without a loader", () => {
    const { container } = render(<Hero />);
    act(() => void vi.advanceTimersByTime(6_000));
    expect(pending(container)).toBe(0);
  });

  it("on a phone: the compact list carries the loader's marks and the fit check, and no 3D is awaited", async () => {
    const { container } = render(<Hero />);
    await flush();
    const target = container.querySelector("[data-loader-target]");
    expect(target?.tagName).toBe("UL");
    expect(target?.querySelectorAll("[data-loader-mark]")).toHaveLength(6);
    expect(container.querySelector("section")?.hasAttribute("data-hero")).toBe(false);
    expect(container.querySelector("[data-sheet][data-hero]")).toBeTruthy();
    expect(readySignals()).toEqual(expect.arrayContaining(["hero-data", "images", "scene-chunk", "scene-frame"]));
  });

  it("on a desktop with a GPU: the 3D scene, the legend as the loader's target, the section as the hero", async () => {
    wide = true;
    gpu = true;
    const { container } = render(<Hero />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(container.querySelector("section canvas")).toBeTruthy();
    expect(container.querySelector("section")?.hasAttribute("data-hero")).toBe(true);
    const target = container.querySelector("[data-loader-target]");
    expect(target?.querySelectorAll("button")).toHaveLength(6);
    expect(readySignals()).toEqual(expect.arrayContaining(["scene-chunk", "scene-frame"]));
  });

  it("under reduced motion: no 3D, every status read, nothing to replay", () => {
    wide = true;
    gpu = true;
    reduced = true;
    const { container } = render(<Hero />);
    expect(container.querySelector("section canvas")).toBeNull();
    expect(container.querySelectorAll("[data-req][data-pending]")).toHaveLength(0);
    expect(container.textContent).not.toContain("Replay the reading");
    expect(readySignals()).toEqual(expect.arrayContaining(["scene-chunk", "scene-frame"]));
  });

  it("without a hardware GPU on a desktop: the HTML figure side by side, no canvas", () => {
    wide = true;
    const { container } = render(<Hero />);
    expect(container.querySelector("section canvas")).toBeNull();
    expect(container.querySelector("[data-req]")?.tagName).toBe("DIV");
  });
});
