export type NavItem = {
  href: string;
  labelKey:
    | "nav.analyses"
    | "nav.interviews"
    | "nav.howItWorks"
    | "nav.pricing"
    | "nav.account"
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

// The two account pages are siblings: each is current only on itself.
const ACCOUNT: NavItem = { href: "/account", labelKey: "nav.account", section: [] };
const PLAN_BILLING: NavItem = { href: "/account/billing", labelKey: "nav.planBilling", section: ["/account/billing"] };
const PRICING: NavItem = { href: "/pricing", labelKey: "nav.pricing", section: ["/pricing"] };

/**
 * The account's pages (Clerk's profile is reached from the account page); "Sign out" is an action, not a link.
 * Pricing only when it has something to sell: not to Pro, whose plan and packs live under Plan & billing.
 */
export function accountLinks(offerPricing: boolean): readonly NavItem[] {
  return offerPricing ? [ACCOUNT, PLAN_BILLING, PRICING] : [ACCOUNT, PLAN_BILLING];
}

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
