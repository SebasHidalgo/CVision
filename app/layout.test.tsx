import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import RootLayout, { viewport } from "./layout";

vi.mock("./globals.css", () => ({}));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font", style: { fontFamily: "font" } });
  // Host Grotesk: Clerk's appearance names the design system's text face.
  return { Fraunces: font, IBM_Plex_Mono: font, Schibsted_Grotesk: font, Host_Grotesk: font };
});
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en", getT: async () => (key: string) => key }));
vi.mock("@clerk/nextjs", () => ({ ClerkProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/providers/I18nProvider", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/providers/Providers", () => ({ default: ({ children }: { children: ReactNode }) => children }));

type Element = ReactElement<{ children?: ReactNode; telemetry?: unknown; dangerouslySetInnerHTML?: { __html: string } }>;

/** Runs an inline script against a stand-in <html> and returns the attributes it set. */
function attributesSetBy(script: string) {
  const attributes = new Map<string, string>();
  const element = {
    dataset: new Proxy({}, { set: (_target, key, value) => (attributes.set(`data-${String(key)}`, String(value)), true) }),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    removeAttribute: (name: string) => attributes.delete(name),
    style: {},
  };
  new Function("document", "location", "window", "setTimeout", script)({ documentElement: element }, { pathname: "/pricing" }, {}, () => 0);
  return attributes;
}

/** The root layout's own tree, read from the element it returns: no render needed. */
async function tree() {
  const provider = (await RootLayout({ children: null })) as Element;
  const html = provider.props.children as Element;
  const [head] = html.props.children as Element[];
  return { provider, head };
}

describe("the root layout", () => {
  it("turns Clerk's telemetry off: a development instance would send it to a host the CSP blocks", async () => {
    const { provider } = await tree();
    expect(provider.props.telemetry).toBe(false);
  });

  it("gives the browser one theme color, not a light/dark pair", () => {
    expect(viewport.themeColor).toBe("#0c0d0f");
  });

  it("marks <html data-js> from an inline script in <head>, before first paint", async () => {
    const { head } = await tree();
    expect(head.type).toBe("head");
    const script = head.props.children as Element;
    expect(script.type).toBe("script");
    expect(attributesSetBy(script.props.dangerouslySetInnerHTML?.__html ?? "").get("data-js")).toBe("");
  });
});
