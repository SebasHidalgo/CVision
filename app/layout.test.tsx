import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "./layout";

vi.mock("./globals.css", () => ({}));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font" });
  return { Fraunces: font, IBM_Plex_Mono: font, Schibsted_Grotesk: font };
});
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en", getT: async () => (key: string) => key }));
vi.mock("@clerk/nextjs", () => ({ ClerkProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/providers/I18nProvider", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/providers/Providers", () => ({ default: ({ children }: { children: ReactNode }) => children }));

type Element = ReactElement<{ children?: ReactNode; telemetry?: unknown; dangerouslySetInnerHTML?: { __html: string } }>;

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

  it("marks <html data-js> from an inline script in <head>, before first paint", async () => {
    const { head } = await tree();
    expect(head.type).toBe("head");
    const script = head.props.children as Element;
    expect(script.type).toBe("script");
    expect(script.props.dangerouslySetInnerHTML?.__html).toBe('document.documentElement.dataset.js=""');
  });
});
