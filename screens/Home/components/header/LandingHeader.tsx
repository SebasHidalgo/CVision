"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import SignInCta from "@/components/auth/SignInCta";
import { buttonClass, ButtonLink, textLinkClass } from "@/components/design-system/Button";
import { Logo } from "@/components/design-system/Logo";
import UserDropdown from "@/components/navbar/UserDropdown";
import { BRAND } from "@/lib/brand";
import { LandingLocaleMenu } from "./LandingLocaleMenu";
import { MenuPanel } from "./MenuPanel";
import { SECTION_LINKS } from "./sections";

const NAV_LINK = "inline-flex min-h-11 items-center whitespace-nowrap text-[14.5px] text-ed-ink-2 no-underline hover:text-ed-ink";

/** The landing's header: sections and sign-up signed out; the app's pages, a new analysis and the account signed in. */
export function LandingHeader() {
  const { t } = useTranslation("landing");
  const { t: tc } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !toggle.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <header className="ed-chrome sticky top-0 z-30 border-b border-ed-line bg-ed-bg/95">
      <div className="ed-wrap flex h-ed-header items-center gap-6">
        <a href="#top" aria-label={tc("nav.home", { brand: BRAND.name })} className="inline-flex min-h-11 items-center pt-1 no-underline">
          <Logo />
        </a>

        <SignedOut>
          <nav aria-label={t("header.sectionsLabel")} className="ml-7 hidden gap-[26px] min-[961px]:flex">
            {SECTION_LINKS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className={NAV_LINK}>
                {t(s.key)}
              </a>
            ))}
          </nav>
        </SignedOut>
        <SignedIn>
          <nav aria-label={tc("nav.primary")} className="ml-7 hidden gap-[26px] min-[961px]:flex">
            <Link href="/resume/analyses" className={NAV_LINK}>
              {tc("nav.analyses")}
            </Link>
            <Link href="/interviews" className={NAV_LINK}>
              {tc("nav.interviews")}
            </Link>
          </nav>
        </SignedIn>

        <div className="ml-auto flex items-center gap-2.5 min-[561px]:gap-4">
          <LandingLocaleMenu />
          <SignedOut>
            <SignInCta>
              <button type="button" className={`${textLinkClass} max-[560px]:hidden`}>
                {t("header.signIn")}
              </button>
            </SignInCta>
            <SignInCta mode="signUp" forceRedirectUrl="/resume/upload">
              <button type="button" className={buttonClass({ size: "sm", className: "max-[560px]:px-3.5" })}>
                {t("header.createAccount")}
              </button>
            </SignInCta>
          </SignedOut>
          <SignedIn>
            <ButtonLink href="/resume/upload" size="sm" className="max-[560px]:px-3.5">
              <Plus aria-hidden className="size-4 max-[359px]:hidden" />
              {tc("nav.newAnalysis")}
            </ButtonLink>
            <UserDropdown />
          </SignedIn>
          <button
            ref={toggle}
            type="button"
            className="grid size-11 cursor-pointer place-items-center rounded-full border border-ed-line-2 bg-transparent text-ed-ink min-[961px]:hidden"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sr-only">{open ? tc("nav.closeMenu") : tc("nav.openMenu")}</span>
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden focusable="false">
              <path d={open ? "M5 5l12 12M17 5 5 17" : "M3 8h16M3 14h16"} stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
      </div>
      <MenuPanel id={menuId} ref={panel} open={open} onNavigate={() => setOpen(false)} />
    </header>
  );
}
