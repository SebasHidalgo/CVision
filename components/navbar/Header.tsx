"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import SignInCta from "@/components/auth/SignInCta";
import Wordmark from "@/components/brand/Wordmark";
import LocaleMenu from "@/components/i18n/LocaleMenu";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import MobileMenu from "./MobileMenu";
import { currentFor, SIGNED_IN_NAV, SIGNED_OUT_NAV, type NavItem } from "./nav";
import UserDropdown from "./UserDropdown";

/** Whether the page has scrolled under the header: it gains its rule and a frosted ground. */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return scrolled;
}

function PrimaryNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const { t } = useTranslation("common");
  return (
    <nav aria-label={t("nav.primary")} className="hidden items-center gap-6 md:flex lg:gap-8">
      {items.map((item) => {
        const active = currentFor(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active}
            className={cn(
              "relative whitespace-nowrap py-1 text-sm font-medium transition-colors duration-200",
              active ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {t(item.labelKey)}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 -bottom-0.5 h-[2px] origin-left bg-signal transition-transform duration-300 ease-out-expo",
                active ? "scale-x-100" : "scale-x-0",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}

/** Language and theme: the same pair, signed in or out, from md up. */
function Preferences() {
  return (
    <div className="hidden items-center gap-1 md:flex">
      <LocaleMenu />
      <ThemeToggle />
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const { t } = useTranslation("common");
  const scrolled = useScrolled();

  return (
    <header
      data-scrolled={scrolled ? "" : undefined}
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300 ease-out-expo",
        scrolled ? "border-line bg-paper/80 backdrop-blur-md" : "border-transparent",
      )}
    >
      <div className="wrap flex h-16 items-center gap-3 md:gap-6">
        <div className="flex min-w-0 items-center gap-8 lg:gap-12">
          <Wordmark className="shrink-0" />
          <SignedIn>
            <PrimaryNav items={SIGNED_IN_NAV} />
          </SignedIn>
          <SignedOut>
            <PrimaryNav items={SIGNED_OUT_NAV} />
          </SignedOut>
        </div>

        <SignedIn>
          <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
            <Button asChild size="sm" className="h-9 gap-1.5 px-3.5">
              <Link href="/resume/upload" aria-current={pathname === "/resume/upload" ? "page" : undefined}>
                {/* Dropped on the narrowest phones, where logo, label and menu button would not fit. */}
                <Plus aria-hidden className="size-4 max-[359px]:hidden" />
                {t("nav.newAnalysis")}
              </Link>
            </Button>
            <Preferences />
            <div className="hidden md:block">
              <UserDropdown />
            </div>
            <MobileMenu signedIn className="md:hidden" />
          </div>
        </SignedIn>

        <SignedOut>
          <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
            <Preferences />
            <SignInCta>
              <Button variant="ghost" size="sm" className="hidden h-9 px-3.5 md:inline-flex">
                {t("nav.signIn")}
              </Button>
            </SignInCta>
            <SignInCta forceRedirectUrl="/resume/upload" mode="signUp">
              <Button size="sm" className="h-9 px-3.5">
                {t("nav.startFree")}
              </Button>
            </SignInCta>
            <MobileMenu signedIn={false} className="md:hidden" />
          </div>
        </SignedOut>
      </div>
    </header>
  );
}
