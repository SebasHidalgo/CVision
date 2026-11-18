// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRAND } from "@/lib/brand";
import type { Namespace } from "@/lib/i18n/config";
import { Footer } from "./Footer";

const request = vi.hoisted(() => ({ pathname: "/pricing" }));

vi.mock("@/lib/i18n/server", async () => {
  const { tFor } = await import("@/lib/i18n/testing");
  return { getT: async (ns: Namespace) => tFor(ns, "en") };
});
vi.mock("next/navigation", () => ({ usePathname: () => request.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/design-system/fonts", () => ({ fontText: { variable: "font-text", style: { fontFamily: "font-text" } } }));

afterEach(() => {
  cleanup();
  request.pathname = "/pricing";
});

describe("the footer", () => {
  it("links the product pages, the legal drafts and the support address", async () => {
    render(await Footer({}));
    const nav = within(screen.getByRole("contentinfo")).getByRole("navigation", { name: "Footer" });
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/#how-it-works",
      "/pricing",
      "/terms",
      "/privacy",
      "/refunds",
      `mailto:${BRAND.supportEmail}`,
    ]);
    expect(screen.getByRole("contentinfo").textContent).toContain(`© ${new Date().getUTCFullYear()} ${BRAND.name}`);
  });

  it("stays out from under the interview room, and not from its feedback", async () => {
    request.pathname = "/interview/abc";
    const { unmount } = render(await Footer({}));
    expect(screen.queryByRole("contentinfo")).toBeNull();
    unmount();
    request.pathname = "/interview/abc/feedback";
    render(await Footer({}));
    expect(screen.getByRole("contentinfo")).toBeTruthy();
  });
});
