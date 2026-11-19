"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import SignInCta from "@/components/auth/SignInCta";
import { buttonClass, ButtonLink, textLinkClass } from "@/components/design-system/Button";
import { fontText } from "@/components/design-system/fonts";
import { Logo } from "@/components/design-system/Logo";
import { cn } from "@/lib/utils";
import LocaleSwitch from "./LocaleSwitch";
import MenuSheet from "./MenuSheet";
import { currentFor, LANDING_SECTIONS, SIGNED_IN_NAV, SIGNED_OUT_NAV, type HeaderVariant, type NavItem } from "./nav";
import UserMenu from "./UserMenu";

// Where the header stops using the sheet: the landing's five sections need more room than the app's two pages
// (measured with the real faces: in Spanish they fit from 1024 px, not before).
const DESKTOP: Record<HeaderVariant, { show: string; hide: string; query: string }> = {
  app: { show: "hidden md:flex", hide: "md:hidden", query: "(min-width: 48rem)" },
  marketing: { show: "hidden lg:flex", hide: "lg:hidden", query: "(min-width: 64rem)" },
};

// Full header height, so the current page's 2 px bar sits on the header's bottom rule.
const NAV_LINK =
  "relative -mx-1 inline-flex items-center px-1 whitespace-nowrap text-[14.5px] no-underline transition-colors duration-200 focus-visible:outline-offset-[-2px] " +
  "after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:origin-left after:bg-ink after:transition-transform after:duration-[380ms] after:ease-settle motion-reduce:after:transition-none";

function NavLinks({ items, label, className }: { items: readonly NavItem[]; label: string; className: string }) {
  const pathname = usePathname();
  const { t } = useTranslation("common");
  return (
    <nav aria-label={label} className={cn("ml-4 self-stretch gap-5 xl:ml-8 xl:gap-7", className)}>
      {items.map((item) => {
        const current = currentFor(item, pathname);
        const linkClass = cn(NAV_LINK, current ? "text-ink after:scale-x-100" : "text-ink-2 after:scale-x-0 hover:text-ink");
        return item.href.startsWith("#") ? (
          <a key={item.href} href={item.href} className={linkClass}>
            {t(item.labelKey)}
          </a>
        ) : (
          <Link key={item.href} href={item.href} aria-current={current} className={linkClass}>
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The one header, on every page. `app`: the app's pages, a new analysis and the account signed in; how it works,
 * pricing and the sign-in actions signed out; the language switches in place. `marketing` (the landing): the
 * landing's sections signed out, the same app actions signed in, and a language switch that reloads. Dark chrome
 * that carries its own design root, so it reads the same over pages still in the old light design. Rendered by
 * the server's SiteHeader, which says whether the account menu offers Pricing (not to Pro).
 */
export function SiteHeaderClient({ variant = "app", offerPricing = true }: { variant?: HeaderVariant; offerPricing?: boolean }) {
  const { t } = useTranslation("common");
  const pathname = usePathname();
  const marketing = variant === "marketing";
  const desktop = DESKTOP[variant];
  const logoClass = "inline-flex min-h-11 shrink-0 items-center pt-1 no-underline";

  return (
    <header className={cn("root chrome sticky top-0 z-40 border-b border-line bg-bg", fontText.variable)}>
      <div className="wrap flex h-16 items-center gap-2 sm:gap-4">
        {marketing ? (
          <a href="#top" aria-label={t("nav.home")} className={logoClass}>
            <Logo />
          </a>
        ) : (
          <Link href="/" aria-label={t("nav.home")} className={logoClass}>
            <Logo />
          </Link>
        )}

        <SignedIn>
          <NavLinks items={SIGNED_IN_NAV} label={t("nav.primary")} className={desktop.show} />
        </SignedIn>
        <SignedOut>
          {marketing ? (
            <NavLinks items={LANDING_SECTIONS} label={t("nav.sectionsLabel")} className={desktop.show} />
          ) : (
            <NavLinks items={SIGNED_OUT_NAV} label={t("nav.primary")} className={desktop.show} />
          )}
        </SignedOut>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <div className={desktop.show}>
            <LocaleSwitch reload={marketing} />
          </div>
          <SignedOut>
            <SignInCta>
              <button type="button" className={cn(textLinkClass, "max-sm:hidden")}>
                {t("nav.signIn")}
              </button>
            </SignInCta>
            {/* Below 360 px it lives in the sheet only: logo, label and menu button would not fit. */}
            <SignInCta mode="signUp" forceRedirectUrl="/resume/upload">
              <button type="button" className={buttonClass({ size: "sm", className: "max-[559px]:px-3.5 max-[359px]:hidden" })}>
                {t("nav.startFree")}
              </button>
            </SignInCta>
          </SignedOut>
          <SignedIn>
            <ButtonLink
              href="/resume/upload"
              size="sm"
              aria-current={pathname === "/resume/upload" ? "page" : undefined}
              className="max-[559px]:px-3.5"
            >
              <Plus aria-hidden className="size-4 max-[359px]:hidden" />
              {t("nav.newAnalysis")}
            </ButtonLink>
            <div className={desktop.show}>
              <UserMenu offerPricing={offerPricing} />
            </div>
          </SignedIn>
          <MenuSheet variant={variant} desktopQuery={desktop.query} className={desktop.hide} offerPricing={offerPricing} />
        </div>
      </div>
    </header>
  );
}
