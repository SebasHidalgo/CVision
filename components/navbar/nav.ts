export type NavItem = {
  href: string;
  labelKey: "nav.analyses" | "nav.interviews" | "nav.howItWorks" | "nav.pricing" | "nav.planBilling";
  /** Path prefixes that belong to the item's section; none for an in-page anchor. */
  section: readonly string[];
};

export const SIGNED_IN_NAV: readonly NavItem[] = [
  { href: "/resume/analyses", labelKey: "nav.analyses", section: ["/resume/analyses", "/resume/analysis/"] },
  { href: "/interviews", labelKey: "nav.interviews", section: ["/interviews", "/interview/"] },
];

export const SIGNED_OUT_NAV: readonly NavItem[] = [
  { href: "/#how", labelKey: "nav.howItWorks", section: [] },
  { href: "/pricing", labelKey: "nav.pricing", section: ["/pricing"] },
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
