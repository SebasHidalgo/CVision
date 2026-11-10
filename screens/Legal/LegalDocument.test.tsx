// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Locale, Namespace } from "@/lib/i18n/config";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY_NAME } from "@/lib/legal";
import PrivacyScreen from "./PrivacyScreen";
import RefundsScreen from "./RefundsScreen";
import TermsScreen from "./TermsScreen";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

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
] as const;

async function renderIn(locale: Locale, Screen: () => Promise<React.ReactElement>) {
  request.locale = locale;
  const rendered = render(await Screen());
  return {
    container: rendered.container,
    banner: screen.getByRole("note").textContent ?? "",
    unmount: rendered.unmount,
  };
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
});
