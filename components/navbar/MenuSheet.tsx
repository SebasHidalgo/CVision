"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SignedIn, SignedOut, useClerk, useUser } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import SignInCta from "@/components/auth/SignInCta";
import { buttonClass } from "@/components/design-system/Button";
import { useLocaleSwitch } from "@/hooks/useLocaleSwitch";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { accountLinks, currentFor, LANDING_SECTIONS, SIGNED_IN_NAV, SIGNED_OUT_NAV, type HeaderVariant, type NavItem } from "./nav";
import UserAvatar, { UserIdentity } from "./UserAvatar";

type MenuSheetProps = {
  variant: HeaderVariant;
  /** The width from which the header shows everything itself: the sheet closes when the page grows past it. */
  desktopQuery: string;
  /** Applied to the trigger; the header hides it at its desktop width. */
  className?: string;
  /** Whether the account links include Pricing: not for Pro (the server decides). */
  offerPricing: boolean;
};

// The sheet slides from the right edge; its backdrop fades. Both run their exit too (`transition-discrete`).
const SHEET =
  "fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(22rem,100vw)] max-w-none overflow-hidden border-0 border-l border-ed-line-2 bg-ed-panel p-0 text-ed-ink " +
  "translate-x-full transition-[translate,overlay,display] transition-discrete duration-[380ms] ease-ed-settle open:translate-x-0 starting:open:translate-x-full " +
  "backdrop:bg-black/60 backdrop:opacity-0 backdrop:transition-[opacity,overlay,display] backdrop:transition-discrete backdrop:duration-[380ms] " +
  "open:backdrop:opacity-100 starting:open:backdrop:opacity-0 motion-reduce:transition-none motion-reduce:backdrop:transition-none";

const PAGE_ROW =
  "flex min-h-12 items-center border-b border-ed-line py-2 font-ed-display text-[22px] leading-tight font-light no-underline [font-variation-settings:'opsz'_48] transition-colors duration-200";
const ACCOUNT_ROW =
  "flex min-h-11 w-full cursor-pointer items-center bg-transparent text-left text-ed-body text-ed-ink-2 no-underline transition-colors duration-200 hover:text-ed-ink";

/**
 * Below the header's desktop width: pages, account, language and the sign-in actions in a side sheet. A modal
 * native <dialog> gives the focus trap and an inert page behind it; Escape and every close return focus to the
 * trigger. No Radix menu goes inside: those portal into <body>, which is inert while the dialog is open.
 */
export default function MenuSheet({ variant, desktopQuery, className, offerPricing }: MenuSheetProps) {
  const { t } = useTranslation("common");
  const pathname = usePathname();
  const { user } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const marketing = variant === "marketing";
  const { current, pending, switchTo, prefetch } = useLocaleSwitch({ reload: marketing });
  const sheet = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const sheetId = `${id}sheet`;
  const titleId = `${id}title`;
  const languageId = `${id}language`;

  const show = () => {
    sheet.current?.showModal();
    setOpen(true);
    if (!marketing) for (const locale of LOCALES) if (locale !== current) prefetch(locale);
  };
  const close = () => sheet.current?.close();

  // A navigation closes it (back and forward included), and so does growing past the desktop width.
  useEffect(() => {
    sheet.current?.close();
  }, [pathname]);
  useEffect(() => {
    const desktop = typeof window.matchMedia === "function" ? window.matchMedia(desktopQuery) : null;
    if (!desktop) return;
    const onChange = () => {
      if (desktop.matches) sheet.current?.close();
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, [desktopQuery]);

  // Clerk's modals mount in <body>: the sheet closes first so they are not inert.
  const openAccount = () => {
    close();
    openUserProfile();
  };
  const leave = () => {
    close();
    void signOut({ redirectUrl: "/" });
  };

  const pages = (items: readonly NavItem[], label: string) => (
    <nav aria-label={label}>
      <ul>
        {items.map((item) => {
          const active = currentFor(item, pathname);
          const rowClass = cn(PAGE_ROW, active ? "text-ed-ink" : "text-ed-ink-2 hover:text-ed-ink");
          // The current page carries the logo's ink square after its name.
          const name = (
            <span className="inline-flex items-end gap-1.5">
              {t(item.labelKey)}
              {active && <span aria-hidden className="mb-[6px] size-[6px] bg-ed-ink" />}
            </span>
          );
          return (
            <li key={item.href}>
              {item.href.startsWith("#") ? (
                <a href={item.href} onClick={close} className={rowClass}>
                  {name}
                </a>
              ) : (
                <Link href={item.href} onClick={close} aria-current={active} className={rowClass}>
                  {name}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={show}
        aria-label={t("nav.openMenu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={sheetId}
        className={cn("grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-ed-line-2 bg-transparent text-ed-ink transition-colors duration-200 hover:border-ed-ink-2", className)}
      >
        <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden focusable="false">
          <path d="M3 8h16M3 14h16" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      <dialog
        ref={sheet}
        id={sheetId}
        aria-labelledby={titleId}
        className={SHEET}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          // Only the backdrop closes it; clicks inside the sheet land on its children.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-ed-line px-5">
            <h2 id={titleId} className="ed-cap">
              {t("nav.menu")}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={t("nav.closeMenu")}
              className="-mr-1.5 grid size-11 cursor-pointer place-items-center rounded-full text-ed-ink-2 transition-colors duration-200 hover:text-ed-ink"
            >
              <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden focusable="false">
                <path d="M5 5l12 12M17 5 5 17" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </div>

          <div className="flex flex-1 flex-col overflow-y-auto px-5 pt-4 pb-8">
            <SignedIn>
              {user && (
                <div className="mb-3 flex items-center gap-3 pb-2">
                  <UserAvatar user={user} />
                  <UserIdentity user={user} fallback={t("nav.yourAccount")} />
                </div>
              )}
              {pages(SIGNED_IN_NAV, t("nav.primary"))}
              <ul className="mt-4">
                <li>
                  <button type="button" onClick={openAccount} className={ACCOUNT_ROW}>
                    {t("nav.account")}
                  </button>
                </li>
                {accountLinks(offerPricing).map((item) => {
                  const active = currentFor(item, pathname);
                  return (
                    <li key={item.href}>
                      <Link href={item.href} onClick={close} aria-current={active} className={cn(ACCOUNT_ROW, active && "text-ed-ink")}>
                        {t(item.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </SignedIn>
            <SignedOut>
              {marketing ? pages(LANDING_SECTIONS, t("nav.sectionsLabel")) : pages(SIGNED_OUT_NAV, t("nav.primary"))}
            </SignedOut>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ed-line pt-5">
              <p id={languageId} className="ed-cap">
                {t("locale.label")}
              </p>
              <div role="group" aria-labelledby={languageId} className="flex gap-1.5">
                {LOCALES.map((locale) => {
                  const active = locale === current;
                  return (
                    <button
                      key={locale}
                      type="button"
                      lang={locale}
                      aria-pressed={active}
                      onClick={() => switchTo(locale)}
                      className={cn(
                        "min-h-11 cursor-pointer rounded-full border px-4 text-[15px] transition-colors duration-200",
                        active ? "border-ed-ink bg-ed-ink text-ed-bg" : "border-ed-line-2 text-ed-ink-2 hover:border-ed-ink-2 hover:text-ed-ink",
                        pending === locale && "opacity-60",
                      )}
                    >
                      {LOCALE_NAMES[locale]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-auto grid gap-2.5 pt-8">
              <SignedIn>
                <button type="button" onClick={leave} className={buttonClass({ variant: "ghost", className: "w-full" })}>
                  {t("nav.signOut")}
                </button>
              </SignedIn>
              <SignedOut>
                <SignInCta forceRedirectUrl="/resume/upload" mode="signUp">
                  <button type="button" onClick={close} className={buttonClass({ className: "w-full" })}>
                    {t("nav.startFree")}
                  </button>
                </SignInCta>
                <SignInCta>
                  <button type="button" onClick={close} className={buttonClass({ variant: "ghost", className: "w-full" })}>
                    {t("nav.signIn")}
                  </button>
                </SignInCta>
              </SignedOut>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
