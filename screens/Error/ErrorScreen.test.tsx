// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalError from "@/app/global-error";
import type { Locale } from "@/lib/i18n/config";
import enCopy from "@/locales/en/errorPage.json";
import esCopy from "@/locales/es/errorPage.json";
import ErrorScreen from "./ErrorScreen";
import GlobalErrorScreen from "./GlobalErrorScreen";
import { digestOf } from "./utils/copy";

const request = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("@/hooks/useLocale", () => ({ useLocale: () => request.locale }));
vi.mock("@/components/design-system/fonts", () => ({ fontText: { variable: "font-text", style: { fontFamily: "font-text" } } }));
vi.mock("@/app/globals.css", () => ({}));

afterEach(() => {
  cleanup();
  request.locale = "en";
});

const COPY = { en: enCopy, es: esCopy };
const SECRET = "connect ECONNREFUSED 10.0.0.3:5432 for user_2abc";

/** A server error as Next hands it over: a message (dev) and the digest of its log line. */
function serverError(digest = "1234567890") {
  return Object.assign(new Error(SECRET), { digest });
}

describe("the error page", () => {
  it.each(["en", "es"] as const)("says it went wrong on our side in %s, with retry and home, and the digest", (locale) => {
    request.locale = locale;
    const retry = vi.fn();
    render(<ErrorScreen error={serverError()} retry={retry} variant="shell" />);
    const copy = COPY[locale];
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(copy.title);
    expect(screen.getByText(copy.body)).toBeTruthy();
    expect(screen.getByText(copy.reference.replace("{{digest}}", "1234567890"))).toBeTruthy();
    expect(screen.getByRole("link", { name: copy.home }).getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/\{\{|\}\}/);
  });

  it("never shows the error's message or stack", () => {
    const error = serverError();
    render(<ErrorScreen error={error} retry={() => {}} variant="bare" />);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain("ECONNREFUSED");
    expect(document.body.textContent).not.toMatch(/\bat \w+ \(|\.tsx?:\d+/);
  });

  it("shows no reference for an error thrown in the browser, which has no digest", () => {
    render(<ErrorScreen error={new TypeError("x is undefined")} retry={() => {}} variant="shell" />);
    expect(screen.queryByText(/^Reference/)).toBeNull();
    expect(document.body.textContent).not.toContain("x is undefined");
  });

  it("draws its own band with the wordmark only when the shell is gone", () => {
    const { unmount } = render(<ErrorScreen error={serverError()} retry={() => {}} variant="bare" />);
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: enCopy.home })).toHaveLength(2);
    unmount();
    render(<ErrorScreen error={serverError()} retry={() => {}} variant="shell" />);
    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.getAllByRole("link", { name: enCopy.home })).toHaveLength(1);
  });

  it("lets go of the landing loader's scroll lock at once when the landing failed under it", () => {
    window.__cvReveal = vi.fn();
    render(<ErrorScreen error={serverError()} retry={() => {}} variant="bare" />);
    expect(window.__cvReveal).toHaveBeenCalled();
    delete window.__cvReveal;
  });

  it("takes focus to its heading, so a screen reader hears what replaced the page", () => {
    render(<ErrorScreen error={serverError()} retry={() => {}} variant="shell" />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });
});

describe("the root error page", () => {
  it("speaks both languages, each marked with its lang, and offers retry and home in both", () => {
    const retry = vi.fn();
    render(<GlobalErrorScreen error={serverError("abc")} retry={retry} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain(enCopy.title);
    expect(heading.querySelector('[lang="es"]')?.textContent).toBe(esCopy.title);
    expect(document.querySelector('p[lang="en"]')?.textContent).toBe(enCopy.body);
    expect(document.querySelector('p[lang="es"]')?.textContent).toBe(esCopy.body);
    fireEvent.click(screen.getByRole("button", { name: `${enCopy.retry} · ${esCopy.retry}` }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("link", { name: `${enCopy.home} · ${esCopy.home}` })[0].getAttribute("href")).toBe("/");
  });

  it("is a whole document with no providers, and leaks nothing of the error", () => {
    const html = renderToStaticMarkup(<GlobalError error={serverError()} retry={() => {}} />);
    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toMatch(/<body class="ed-root /);
    expect(html).toContain(enCopy.title);
    expect(html).toContain(esCopy.title);
    expect(html).not.toContain(SECRET);
    expect(html).not.toMatch(/\{\{|\}\}/);
  });
});

describe("digestOf", () => {
  it("reads Next's digest and nothing else", () => {
    expect(digestOf(serverError("42"))).toBe("42");
    expect(digestOf(new Error("no digest"))).toBeNull();
    expect(digestOf({ digest: 42 })).toBeNull();
    expect(digestOf({ digest: "<script>" })).toBeNull();
    expect(digestOf("thrown string")).toBeNull();
    expect(digestOf(null)).toBeNull();
  });
});
