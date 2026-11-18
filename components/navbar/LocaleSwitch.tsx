"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Globe, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fontText } from "@/components/design-system/fonts";
import { useLocaleSwitch } from "@/hooks/useLocaleSwitch";
import { isLocale, LOCALE_NAMES, LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { MENU_CONTENT, MENU_ITEM, MENU_LABEL } from "./menuStyles";

/**
 * The header's language menu: globe and code, each language named in itself. In place everywhere (the other
 * language's strings are fetched on intent, so the switch is immediate); `reload` on the landing, whose
 * entrance plays again in the new language.
 */
export default function LocaleSwitch({ reload = false }: { reload?: boolean }) {
  const { t } = useTranslation("common");
  const { current, pending, switchTo, prefetch } = useLocaleSwitch({ reload });
  const Icon = pending ? Loader2 : Globe;

  const prefetchOthers = () => {
    if (reload) return;
    for (const locale of LOCALES) if (locale !== current) prefetch(locale);
  };

  return (
    <DropdownMenu.Root onOpenChange={(open) => open && prefetchOthers()}>
      <DropdownMenu.Trigger
        aria-label={t("locale.current", { code: current.toUpperCase(), language: LOCALE_NAMES[current] })}
        aria-busy={pending !== null}
        onPointerEnter={prefetchOthers}
        onFocus={prefetchOthers}
        className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-ed-ink-2 transition-colors duration-200 hover:text-ed-ink data-[state=open]:text-ed-ink"
      >
        <Icon aria-hidden className={cn("size-4", pending && "animate-spin motion-reduce:animate-none")} />
        <span className="ed-mono text-[12px] font-medium uppercase tracking-wider">{current}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} className={cn(MENU_CONTENT, "w-48", fontText.variable)}>
          <DropdownMenu.Label className={MENU_LABEL}>{t("locale.label")}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={current} onValueChange={(value) => isLocale(value) && switchTo(value)}>
            {LOCALES.map((locale) => (
              <DropdownMenu.RadioItem key={locale} value={locale} lang={locale} className={cn(MENU_ITEM, "justify-between")}>
                {LOCALE_NAMES[locale]}
                <DropdownMenu.ItemIndicator>
                  <Check aria-hidden className="size-4" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
