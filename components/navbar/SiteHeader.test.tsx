// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { currentShellPlan } from "@/lib/database/usage";
import { SiteHeader as ServerSiteHeader } from "./SiteHeader";
import { SiteHeaderClient as SiteHeader } from "./SiteHeaderClient";

const session = vi.hoisted(() => ({ signedIn: false, pathname: "/" }));
const clerk = vi.hoisted(() => ({ openSignIn: vi.fn(), openSignUp: vi.fn(), openUserProfile: vi.fn(), signOut: vi.fn() }));
const localeSwitch = vi.hoisted(() => ({ switchTo: vi.fn(), prefetch: vi.fn(), options: [] as unknown[] }));

const USER = {
  firstName: "Ada",
  lastName: "Byron",
  fullName: "Ada Byron",
  imageUrl: "",
  primaryEmailAddress: { emailAddress: "ada@example.test" },
};

vi.mock("@clerk/nextjs", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => (session.signedIn ? children : null),
  SignedOut: ({ children }: { children: React.ReactNode }) => (session.signedIn ? null : children),
  useUser: () => ({ isLoaded: true, user: session.signedIn ? USER : null }),
  useClerk: () => clerk,
}));
vi.mock("next/navigation", () => ({ usePathname: () => session.pathname }));
// The server wrapper's one read: the plan, derived on the server.
vi.mock("@/lib/database/usage", () => ({ currentShellPlan: vi.fn(async () => null) }));
// next/font only runs under Next.
vi.mock("@/components/design-system/fonts", () => ({ fontText: { variable: "font-text", style: { fontFamily: "font-text" } } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/useLocaleSwitch", () => ({
  useLocaleSwitch: (options?: unknown) => {
    localeSwitch.options.push(options);
    return { current: "en", pending: null, switchTo: localeSwitch.switchTo, prefetch: localeSwitch.prefetch };
  },
}));

beforeAll(() => {
  // jsdom implements <dialog> without showModal, and has no matchMedia or ResizeObserver (Radix positions with it).
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.clearAllMocks();
  localeSwitch.options = [];
  session.signedIn = false;
  session.pathname = "/";
});
afterEach(cleanup);

const banner = () => screen.getByRole("banner");
/** The header's own links (the sheet's copies sit in a closed dialog, out of the accessibility tree). */
const hrefs = (name: string) => within(banner()).getAllByRole("link", { name }).map((link) => link.getAttribute("href"));

describe("SiteHeader, signed out", () => {
  it("on the landing: the sections as anchors, sign in and start free, a language switch that reloads", () => {
    render(<SiteHeader variant="marketing" />);
    const sections = within(banner()).getByRole("navigation", { name: "Sections" });
    expect(within(sections).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "#how-it-works",
      "#analysis",
      "#interview",
      "#pricing",
      "#faq",
    ]);
    expect(within(banner()).getByRole("link", { name: "CVision — home" }).getAttribute("href")).toBe("#top");
    expect(within(banner()).getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(within(banner()).queryByRole("link", { name: /New analysis/ })).toBeNull();
    expect(localeSwitch.options.every((options) => (options as { reload?: boolean }).reload === true)).toBe(true);

    fireEvent.click(within(banner()).getByRole("button", { name: "Start free" }));
    expect(clerk.openSignUp).toHaveBeenCalledWith({ forceRedirectUrl: "/resume/upload" });
  });

  it("elsewhere: how it works on the landing, the pricing page marked current, the language switching in place", () => {
    session.pathname = "/pricing";
    render(<SiteHeader />);
    expect(hrefs("How it works")[0]).toBe("/#how-it-works");
    expect(within(banner()).getAllByRole("link", { name: "Pricing" })[0].getAttribute("aria-current")).toBe("page");
    expect(within(banner()).getByRole("link", { name: "CVision — home" }).getAttribute("href")).toBe("/");
    expect(within(banner()).getByRole("button", { name: "Start free" })).toBeTruthy();
    expect(localeSwitch.options.every((options) => (options as { reload?: boolean }).reload === false)).toBe(true);
  });
});

describe("SiteHeader, signed in", () => {
  beforeEach(() => {
    session.signedIn = true;
  });

  it("shows the app's pages, a new analysis and the account menu, on the landing too", () => {
    render(<SiteHeader variant="marketing" />);
    expect(hrefs("Analyses")[0]).toBe("/resume/analyses");
    expect(hrefs("Interviews")[0]).toBe("/interviews");
    expect(within(banner()).getByRole("link", { name: "New analysis" }).getAttribute("href")).toBe("/resume/upload");
    expect(within(banner()).getByRole("button", { name: "Account menu" })).toBeTruthy();
    expect(within(banner()).queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(within(banner()).queryByRole("button", { name: "Start free" })).toBeNull();
  });

  it("marks the page as current, and its section on the pages under it", () => {
    session.pathname = "/interviews";
    const { unmount } = render(<SiteHeader />);
    expect(within(banner()).getAllByRole("link", { name: "Interviews" })[0].getAttribute("aria-current")).toBe("page");
    expect(within(banner()).getAllByRole("link", { name: "Analyses" })[0].getAttribute("aria-current")).toBeNull();
    unmount();

    session.pathname = "/resume/analysis/abc";
    render(<SiteHeader />);
    expect(within(banner()).getAllByRole("link", { name: "Analyses" })[0].getAttribute("aria-current")).toBe("true");
  });

  it("names the language button the way the e2e helper finds it, and offers each language in itself", () => {
    render(<SiteHeader />);
    const trigger = within(banner()).getByRole("button", { name: /^(EN|ES), (language|idioma):/ });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["English", "Español"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Español" }));
    expect(localeSwitch.switchTo).toHaveBeenCalledExactlyOnceWith("es");
  });

  it("closes the account menu with Escape and gives focus back to its button", async () => {
    render(<SiteHeader />);
    const trigger = within(banner()).getByRole("button", { name: "Account menu" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("ada@example.test")).toBeTruthy();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    // Radix gives it back once its focus scope unmounts, on the next tick.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("the menu sheet", () => {
  const sheet = () => document.querySelector("dialog") as HTMLDialogElement;

  it("opens from its button and closes from its close button, returning focus", () => {
    session.signedIn = true;
    session.pathname = "/resume/analyses";
    render(<SiteHeader />);
    const trigger = within(banner()).getByRole("button", { name: "Open menu" });
    fireEvent.click(trigger);
    expect(sheet().open).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(within(dialog).getByRole("link", { name: "Analyses" }).getAttribute("aria-current")).toBe("page");
    expect(within(dialog).getByText("Ada Byron")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close menu" }));
    expect(sheet().open).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape and gives focus back to its button", () => {
    render(<SiteHeader variant="marketing" />);
    const trigger = within(banner()).getByRole("button", { name: "Open menu" });
    fireEvent.click(trigger);
    expect(sheet().open).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(sheet().open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes before opening Clerk's modal, and on a navigation", () => {
    const { rerender } = render(<SiteHeader variant="marketing" />);
    fireEvent.click(within(banner()).getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog");
    // Signed out on the landing, the sheet lists the sections and the sign-in actions.
    expect(within(dialog).getAllByRole("link").map((link) => link.getAttribute("href"))).toContain("#faq");
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign in" }));
    expect(sheet().open).toBe(false);
    expect(clerk.openSignIn).toHaveBeenCalledOnce();

    fireEvent.click(within(banner()).getByRole("button", { name: "Open menu" }));
    expect(sheet().open).toBe(true);
    session.pathname = "/pricing";
    act(() => rerender(<SiteHeader variant="marketing" />));
    expect(sheet().open).toBe(false);
  });

  it("switches the language from its own buttons, the current one pressed", () => {
    render(<SiteHeader />);
    fireEvent.click(within(banner()).getByRole("button", { name: "Open menu" }));
    const group = within(screen.getByRole("dialog")).getByRole("group", { name: "Language" });
    expect(within(group).getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "Español" }));
    expect(localeSwitch.switchTo).toHaveBeenCalledWith("es");
    // In place, off the landing: the other language's strings were fetched when the sheet opened.
    expect(localeSwitch.prefetch).toHaveBeenCalledWith("es");
  });
});

describe("Pricing in the account menu", () => {
  beforeEach(() => {
    session.signedIn = true;
    session.pathname = "/resume/analyses";
  });

  const menuLinks = () => {
    fireEvent.keyDown(within(banner()).getByRole("button", { name: "Account menu" }), { key: "Enter" });
    return within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
  };
  const sheetLinks = () => {
    fireEvent.click(within(banner()).getByRole("button", { name: "Open menu" }));
    return within(screen.getByRole("dialog"))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
  };

  it("is offered to Free, in the menu and in the sheet", () => {
    render(<SiteHeader offerPricing />);
    expect(menuLinks()).toEqual(["Account", "Plan & billing", "Pricing", "Sign out"]);
    cleanup();
    render(<SiteHeader offerPricing />);
    expect(sheetLinks()).toContain("/pricing");
  });

  it("is left out for Pro, in the menu and in the sheet, Plan & billing kept", () => {
    render(<SiteHeader offerPricing={false} />);
    expect(menuLinks()).toEqual(["Account", "Plan & billing", "Sign out"]);
    cleanup();
    render(<SiteHeader offerPricing={false} />);
    const sheet = sheetLinks();
    expect(sheet).toContain("/account/billing");
    expect(sheet).not.toContain("/pricing");
  });

  it("the server header decides from the derived plan: hidden for Pro only; signed out or unreadable keeps it", async () => {
    vi.mocked(currentShellPlan).mockResolvedValueOnce("PRO");
    expect((await ServerSiteHeader({})).props).toEqual({ variant: "app", offerPricing: false });

    vi.mocked(currentShellPlan).mockResolvedValueOnce("FREE");
    expect((await ServerSiteHeader({ variant: "marketing" })).props).toEqual({ variant: "marketing", offerPricing: true });

    vi.mocked(currentShellPlan).mockResolvedValueOnce(null);
    expect((await ServerSiteHeader({})).props).toEqual({ variant: "app", offerPricing: true });
  });
});
