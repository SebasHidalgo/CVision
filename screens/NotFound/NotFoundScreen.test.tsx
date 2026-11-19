// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMetadata } from "@/app/not-found";
import type { Locale, Namespace } from "@/lib/i18n/config";
import { tFor } from "@/lib/i18n/testing";
import NotFoundScreen from "./NotFoundScreen";

const request = vi.hoisted(() => ({ locale: "en" as Locale, userId: "user_1" as string | null }));
vi.mock("@/lib/auth", () => ({ getOptionalUserIdOutsideProxy: async () => request.userId }));

// Server components: getT reads the real locale files, in the language the test sets.
vi.mock("@/lib/i18n/server", async () => {
  const { tFor: t } = await import("@/lib/i18n/testing");
  return { getT: async (ns: Namespace) => t(ns, request.locale), getLocale: async () => request.locale };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/design-system/fonts", () => ({ fontText: { variable: "font-text", style: { fontFamily: "font-text" } } }));
// The shell has its own tests (and the footer is an async server component, which a client render cannot await).
vi.mock("@/components/navbar/SiteHeader", () => ({ SiteHeader: () => <header data-testid="site-header" /> }));
vi.mock("@/components/layout/Footer", () => ({ Footer: () => <footer /> }));

afterEach(() => {
  cleanup();
  request.locale = "en";
  request.userId = "user_1";
});

describe("the 404 page", () => {
  it.each(["en", "es"] as const)("says what happened in %s, with a way home and to the analyses, inside the shell", async (locale) => {
    request.locale = locale;
    const t = tFor("notFound", locale);
    render(await NotFoundScreen());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t("title"));
    expect(screen.getByText(t("body"))).toBeTruthy();
    expect(screen.getByText(new RegExp(`404 · ${t("status")}`))).toBeTruthy();
    expect(screen.getByRole("link", { name: t("home") }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: t("analyses") }).getAttribute("href")).toBe("/resume/analyses");
    expect(screen.getByTestId("site-header")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\{\{|\}\}/);
  });

  it("offers the analyses only to a signed-in visitor", async () => {
    request.userId = null;
    render(await NotFoundScreen());
    expect(screen.queryByRole("link", { name: tFor("notFound", "en")("analyses") })).toBeNull();
    expect(screen.getByRole("link", { name: tFor("notFound", "en")("home") })).toBeTruthy();
  });

  it.each(["en", "es"] as const)("titles the document in %s", async (locale) => {
    request.locale = locale;
    expect(await generateMetadata()).toEqual({ title: tFor("notFound", locale)("meta") });
  });
});
