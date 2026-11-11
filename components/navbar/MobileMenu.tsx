"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import SignInCta from "@/components/auth/SignInCta";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useClerkAppearance } from "@/hooks/useClerkAppearance";
import { useLocaleSwitch } from "@/hooks/useLocaleSwitch";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { ACCOUNT_LINKS, currentFor, SIGNED_IN_NAV, SIGNED_OUT_NAV } from "./nav";
import UserAvatar, { UserIdentity } from "./UserAvatar";

type MobileMenuProps = {
  signedIn: boolean;
  /** Applied to the trigger; the header hides it from md up. */
  className?: string;
};

/**
 * Below md: navigation, account, language and theme in a side sheet. A modal native <dialog> gives
 * the focus trap, Escape, an inert page behind it and focus back on the trigger. No Radix menu goes
 * inside: those portal into <body>, which is inert while the dialog is open.
 */
export default function MobileMenu({ signedIn, className }: MobileMenuProps) {
  const { t } = useTranslation("common");
  const pathname = usePathname();
  const { user } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const appearance = useClerkAppearance();
  const { current, pending, switchTo, prefetch } = useLocaleSwitch();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const sheetId = `${id}sheet`;
  const titleId = `${id}title`;
  const languageId = `${id}language`;

  const show = () => {
    ref.current?.showModal();
    setOpen(true);
    for (const locale of LOCALES) if (locale !== current) prefetch(locale);
  };
  const close = () => ref.current?.close();

  // A navigation closes it (back and forward included), and so does growing past md, where its trigger is hidden.
  useEffect(() => {
    ref.current?.close();
  }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 48rem)");
    const onChange = () => {
      if (desktop.matches) ref.current?.close();
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  // Clerk's modals mount in <body>: the sheet closes first so they are not inert.
  const openAccount = () => {
    close();
    openUserProfile({ appearance });
  };
  const leave = () => {
    close();
    void signOut({ redirectUrl: "/" });
  };

  const nav = signedIn ? SIGNED_IN_NAV : SIGNED_OUT_NAV;
  const row = "flex w-full cursor-pointer items-center py-2.5 text-left text-base text-ink-2 transition-colors duration-200 hover:text-ink";

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label={t("nav.openMenu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={sheetId}
        className={cn(
          "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink transition-colors duration-200 hover:bg-paper-2",
          className,
        )}
      >
        <Menu aria-hidden className="size-5" />
      </button>

      <dialog
        ref={ref}
        id={sheetId}
        aria-labelledby={titleId}
        className="drawer w-[min(22rem,100vw)]!"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // Only the backdrop closes it; clicks inside the sheet land on its children.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
            <h2 id={titleId} className="eyebrow">
              {t("nav.menu")}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={t("nav.closeMenu")}
              className="-mr-2 flex size-9 cursor-pointer items-center justify-center rounded-md text-ink-2 transition-colors duration-200 hover:bg-paper-2 hover:text-ink"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>

          <div className="flex flex-1 flex-col overflow-y-auto px-5 pt-5 pb-8">
            {signedIn && user && (
              <div className="mb-5 flex items-center gap-3 border-b border-line pb-5">
                <UserAvatar user={user} />
                <UserIdentity user={user} fallback={t("nav.yourAccount")} />
              </div>
            )}

            <nav aria-label={t("nav.primary")}>
              <ul>
                {nav.map((item) => {
                  const active = currentFor(item, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={close}
                        aria-current={active}
                        className={cn(
                          "display-sm flex py-2.5 transition-colors duration-200",
                          active
                            ? "text-ink underline decoration-signal decoration-2 underline-offset-[0.3em]"
                            : "text-ink-2 hover:text-ink",
                        )}
                      >
                        {t(item.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {signedIn && (
              <ul className="mt-5 border-t border-line pt-3">
                <li>
                  <button type="button" onClick={openAccount} className={row}>
                    {t("nav.account")}
                  </button>
                </li>
                {ACCOUNT_LINKS.map((item) => {
                  const active = currentFor(item, pathname);
                  return (
                    <li key={item.href}>
                      <Link href={item.href} onClick={close} aria-current={active} className={cn(row, active && "text-ink")}>
                        {t(item.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5">
              <div className="flex items-center justify-between gap-4">
                <p id={languageId} className="eyebrow">
                  {t("locale.label")}
                </p>
                <div role="group" aria-labelledby={languageId} className="flex flex-wrap justify-end gap-1.5">
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
                          "h-9 cursor-pointer rounded-md border px-3 text-sm transition-colors duration-200",
                          active ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:bg-paper-2 hover:text-ink",
                          pending === locale && "opacity-60",
                        )}
                      >
                        {LOCALE_NAMES[locale]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <p className="eyebrow">{t("theme.label")}</p>
                <ThemeToggle className="border border-line" />
              </div>
            </div>

            <div className="mt-auto flex flex-col gap-2 pt-8">
              {signedIn ? (
                <Button variant="outline" onClick={leave} className="h-11 w-full">
                  {t("nav.signOut")}
                </Button>
              ) : (
                <>
                  <SignInCta forceRedirectUrl="/resume/upload" mode="signUp">
                    <Button onClick={close} className="h-11 w-full">
                      {t("nav.startFree")}
                    </Button>
                  </SignInCta>
                  <SignInCta>
                    <Button variant="outline" onClick={close} className="h-11 w-full">
                      {t("nav.signIn")}
                    </Button>
                  </SignInCta>
                </>
              )}
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
