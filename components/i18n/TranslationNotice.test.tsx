// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tFor } from "@/lib/i18n/testing";
import en from "@/locales/en/common.json";
import TranslationNotice from "./TranslationNotice";

vi.mock("@/lib/i18n/server", () => ({ getT: async () => tFor("common") }));

afterEach(cleanup);

describe("TranslationNotice", () => {
  it("says nothing when the page is in one language", async () => {
    for (const state of ["none", "ready", "pending"] as const) {
      expect(await TranslationNotice({ state })).toBeNull();
    }
  });

  it("says the translation failed, or which parts kept their original", async () => {
    render((await TranslationNotice({ state: "unavailable" }))!);
    expect(screen.getByRole("note").textContent).toBe(en.translation.unavailable);
    cleanup();
    render((await TranslationNotice({ state: "partial", className: "mt-10" }))!);
    expect(screen.getByRole("note").textContent).toBe(en.translation.partial);
  });

  it("is drawn in the design system: body text in ink-2 behind a still ink mark, never green", async () => {
    render((await TranslationNotice({ state: "partial", className: "mt-10" }))!);
    const note = screen.getByRole("note");
    expect(note.className).toMatch(/\btext-ed-body\b/);
    expect(note.className).toMatch(/\btext-ed-ink-2\b/);
    expect(note.className).toMatch(/\bmt-10\b/);
    const mark = note.querySelector("[data-status-mark]");
    expect(mark?.className).toMatch(/\bbg-ed-ink-2\b/);
    expect(mark?.className).not.toMatch(/animate-pulse/);
    expect(note.outerHTML).not.toMatch(/signal|eyebrow|bg-fair/);
  });
});
