// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Locale, Namespace } from "@/lib/i18n/config";
import { formatLongDate } from "@/lib/format";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY_NAME, LEGAL_UPDATED, type LegalPage } from "@/lib/legal";
import PrivacyScreen from "./PrivacyScreen";
import RefundsScreen from "./RefundsScreen";
import TermsScreen from "./TermsScreen";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/design-system/fonts", () => ({ fontText: { variable: "font-text", style: { fontFamily: "font-text" } } }));

const request = vi.hoisted(() => ({ locale: "en" as Locale }));

// The screens are server components: getT reads the real locale files, in the language the test sets.
vi.mock("@/lib/i18n/server", async () => {
  const { tFor } = await import("@/lib/i18n/testing");
  return {
    getT: async (ns: Namespace) => tFor(ns, request.locale),
    getLocale: async () => request.locale,
  };
});

afterEach(cleanup);

const SCREENS = [
  ["terms", TermsScreen],
  ["privacy", PrivacyScreen],
  ["refunds", RefundsScreen],
] as const satisfies readonly (readonly [LegalPage, () => Promise<React.ReactElement>])[];

/** The anchors are a contract: links to /terms#fair-use live outside the app. Changing one is an edit here. */
const ANCHORS: Record<LegalPage, string[]> = {
  terms: ["what", "account", "plans", "fair-use", "ai", "content", "ending", "liability", "contact"],
  privacy: ["responsible", "collect", "processors", "retention", "rights", "cookies"],
  refunds: ["who", "subscriptions", "packs", "problems", "contact"],
};

async function renderIn(locale: Locale, Screen: () => Promise<React.ReactElement>) {
  request.locale = locale;
  const rendered = render(await Screen());
  return {
    container: rendered.container,
    banner: screen.getByRole("note").textContent ?? "",
    unmount: rendered.unmount,
  };
}

/** The contents list: each entry's target, and the section that target names. */
function contents(container: HTMLElement) {
  const toc = screen.getByRole("navigation", { name: /On this page|En esta página/ });
  return within(toc)
    .getAllByRole("link")
    .map((link) => {
      const href = link.getAttribute("href") ?? "";
      const id = href.slice(1);
      return { href, label: link.textContent ?? "", targets: container.querySelectorAll(`[id="${id}"]`), id };
    });
}

describe("the legal drafts", () => {
  it.each(SCREENS)("%s carries the draft banner, the entity placeholder and the links to the other pages", async (_, Screen) => {
    const { container, banner } = await renderIn("en", Screen);
    expect(banner).toMatch(/DRAFT — not legal advice — to be reviewed before launch/);
    expect(container.textContent).toContain(LEGAL_ENTITY_NAME === "LEGAL_ENTITY_NAME" ? "LEGAL_ENTITY_NAME" : LEGAL_ENTITY_NAME);
    for (const href of ["/terms", "/privacy", "/refunds"]) {
      expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    // The merchant of record is named; the wording rule holds here too.
    expect(container.textContent).toMatch(/Paddle/);
    expect(container.textContent).not.toMatch(/screening|hiring decision|coaching|exam preparation/i);
    expect(container.textContent).not.toMatch(/\{\{|\}\}/);
  });

  it.each(SCREENS)("%s exists in Spanish with the same banner, placeholders, sections and links", async (_, Screen) => {
    const en = await renderIn("en", Screen);
    const enShape = [en.container.querySelectorAll("h2").length, en.container.querySelectorAll("li").length];
    const enHasEmail = en.container.textContent?.includes(LEGAL_CONTACT_EMAIL);
    en.unmount();

    const { container, banner } = await renderIn("es", Screen);
    expect(banner).toMatch(/^BORRADOR — no es asesoramiento legal/);
    expect(container.textContent).toContain(LEGAL_ENTITY_NAME);
    expect(container.textContent?.includes(LEGAL_CONTACT_EMAIL)).toBe(enHasEmail);
    expect([container.querySelectorAll("h2").length, container.querySelectorAll("li").length]).toEqual(enShape);
    for (const href of ["/terms", "/privacy", "/refunds"]) {
      expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    expect(container.textContent).toMatch(/Paddle/);
    expect(container.textContent).not.toMatch(/\{\{|\}\}/);
    expect(container.textContent).not.toMatch(/evaluaci[oó]n de candidatos|selecci[oó]n de personal|decisi[oó]n(?:es)? de contrataci[oó]n|coaching/i);
  });

  it.each(SCREENS)("%s lists every section in its contents, each link pointing at exactly one section", async (page, Screen) => {
    for (const locale of ["en", "es"] as const) {
      const { container, unmount } = await renderIn(locale, Screen);
      const entries = contents(container);
      const sections = [...container.querySelectorAll("section[id]")];
      // One entry per section, in order, each landing on the section itself and named like its heading.
      expect(entries.map((entry) => entry.id)).toEqual(ANCHORS[page]);
      expect(sections.map((section) => section.id)).toEqual(ANCHORS[page]);
      for (const entry of entries) {
        expect(entry.targets).toHaveLength(1);
        const heading = entry.targets[0].querySelector("h2");
        // Both start with the section's number, which is for the eye (aria-hidden).
        const words = (text: string | null | undefined) => (text ?? "").replace(/^\d{2}/, "").trim();
        expect(words(heading?.textContent)).toBe(words(entry.label));
        expect(entry.targets[0].getAttribute("aria-labelledby")).toBe(heading?.id);
      }
      // Every id on the page is unique.
      const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
      expect(new Set(ids).size).toBe(ids.length);
      unmount();
    }
  });

  it.each(SCREENS)("%s says when it last changed, in the reader's language, with a machine-readable date", async (page, Screen) => {
    for (const locale of ["en", "es"] as const) {
      const { container, unmount } = await renderIn(locale, Screen);
      const time = container.querySelector("time");
      expect(time?.getAttribute("datetime")).toBe(LEGAL_UPDATED[page]);
      expect(time?.textContent).toContain(formatLongDate(LEGAL_UPDATED[page], locale));
      unmount();
    }
  });

  it("marks what the draft still lacks, so it can't pass for finished text", async () => {
    const { container } = await renderIn("en", TermsScreen);
    const gaps = [...container.querySelectorAll("[data-legal-placeholder]")].map((gap) => gap.textContent);
    expect(gaps).toContain("[PLACEHOLDER: price changes and how they are notified.]");
    // The entity and the address are placeholders until the deploy phase: marked too, never a mailto to a token.
    if (LEGAL_ENTITY_NAME === "LEGAL_ENTITY_NAME") expect(gaps).toContain("LEGAL_ENTITY_NAME");
    if (!LEGAL_CONTACT_EMAIL.includes("@")) expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("marks the page it is on among the legal pages", async () => {
    await renderIn("en", PrivacyScreen);
    const pages = screen.getByRole("navigation", { name: "Legal pages" });
    expect(within(pages).getByRole("link", { name: "Privacy" }).getAttribute("aria-current")).toBe("page");
    expect(within(pages).getByRole("link", { name: "Refunds" }).getAttribute("aria-current")).toBeNull();
  });
});
