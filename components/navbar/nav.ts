export type NavItem = {
  href: string;
  labelKey:
    | "nav.analyses"
    | "nav.interviews"
    | "nav.howItWorks"
    | "nav.pricing"
    | "nav.planBilling"
    | "nav.analysisSection"
    | "nav.interviewSection"
    | "nav.faq";
  /** Path prefixes that belong to the item's section; none for an in-page anchor. */
  section: readonly string[];
};

export const SIGNED_IN_NAV: readonly NavItem[] = [
  { href: "/resume/analyses", labelKey: "nav.analyses", section: ["/resume/analyses", "/resume/analysis/"] },
  { href: "/interviews", labelKey: "nav.interviews", section: ["/interviews", "/interview/"] },
];

/** A signed-out visitor away from the landing. */
export const SIGNED_OUT_NAV: readonly NavItem[] = [
  { href: "/#how-it-works", labelKey: "nav.howItWorks", section: [] },
  { href: "/pricing", labelKey: "nav.pricing", section: ["/pricing"] },
];

/** The landing's sections, in page order; anchor ids are language-neutral. */
export const LANDING_SECTIONS: readonly NavItem[] = [
  { href: "#how-it-works", labelKey: "nav.howItWorks", section: [] },
  { href: "#analysis", labelKey: "nav.analysisSection", section: [] },
  { href: "#interview", labelKey: "nav.interviewSection", section: [] },
  { href: "#pricing", labelKey: "nav.pricing", section: [] },
  { href: "#faq", labelKey: "nav.faq", section: [] },
];

/** The account's pages; "Account" (Clerk's profile) and "Sign out" are actions, not links. */
export const ACCOUNT_LINKS: readonly NavItem[] = [
  { href: "/account/billing", labelKey: "nav.planBilling", section: ["/account/billing"] },
  { href: "/pricing", labelKey: "nav.pricing", section: ["/pricing"] },
];

/**
 * `aria-current` for a nav link: "page" on the page itself, "true" anywhere else in its section
 * (an analysis under Analyses), nothing outside it.
 */
export function currentFor(item: NavItem, pathname: string): "page" | "true" | undefined {
  if (pathname === item.href) return "page";
  return item.section.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))
    ? "true"
    : undefined;
}

/** "app" on every page but the landing; "marketing" on the landing (its sections, a language switch that reloads). */
export type HeaderVariant = "app" | "marketing";
