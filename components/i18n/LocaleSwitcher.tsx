"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { useLocale } from "@/hooks/useLocale";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { setLocaleAction } from "./actions/setLocaleAction";

type LocaleSwitcherProps = {
  className?: string;
};

/**
 * EN / ES. Saves the cookie (and the account's choice when signed in), then reloads: the server
 * renders every page, Clerk's components and the analyses in the new language.
 */
export default function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const { t } = useTranslation("common");
  const current = useLocale();
  const errorCopy = useErrorCopy();
  const [pending, setPending] = useState<Locale | null>(null);

  const choose = async (locale: Locale) => {
    if (locale === current || pending) return;
    setPending(locale);
    try {
      const result = await setLocaleAction({ locale });
      if (result.ok) {
        // Stays pending until the reload replaces the page.
        window.location.reload();
        return;
      }
      toast.error(errorCopy(result.code, result.meta));
    } catch {
      toast.error(errorCopy("REQUEST_FAILED"));
    }
    setPending(null);
  };

  return (
    <div role="group" aria-label={t("locale.label")} className={cn("flex items-center rounded-md border border-line", className)}>
      {LOCALES.map((locale) => {
        const active = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={active}
            aria-label={active ? LOCALE_NAMES[locale] : t("locale.switchTo", { language: LOCALE_NAMES[locale] })}
            disabled={pending !== null}
            onClick={() => void choose(locale)}
            className={cn(
              "h-8 cursor-pointer px-2 font-mono text-[11px] font-medium uppercase tracking-wider transition-colors duration-200 first:rounded-l-[5px] last:rounded-r-[5px] disabled:cursor-default",
              active ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
              pending === locale && "opacity-60",
            )}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
