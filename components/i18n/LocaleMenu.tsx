"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Globe, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fontText } from "@/components/design-system/fonts";
import { MENU_CONTENT, MENU_ITEM, MENU_LABEL } from "@/components/navbar/menuStyles";
import { useLocaleSwitch } from "@/hooks/useLocaleSwitch";
import { isLocale, LOCALE_NAMES, LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

type LocaleMenuProps = {
  className?: string;
};

/**
 * The interface language as a menu for a settings row (the account page): the current language's name on a pill
 * drawn as a form control, every locale named in its own language, the current one checked. The other languages'
 * strings are fetched on intent (hover, focus, opening), so the switch itself is immediate. The menu portals into
 * <body>, outside the page's design root, so it carries the face itself, like the header's menus.
 */
export default function LocaleMenu({ className }: LocaleMenuProps) {
  const { t } = useTranslation("common");
  const { current, pending, switchTo, prefetch } = useLocaleSwitch();

  const prefetchOthers = () => {
    for (const locale of LOCALES) if (locale !== current) prefetch(locale);
  };

  const Icon = pending ? Loader2 : Globe;

  return (
    <DropdownMenu.Root onOpenChange={(open) => open && prefetchOthers()}>
      <DropdownMenu.Trigger
        aria-label={t("locale.current", { code: current.toUpperCase(), language: LOCALE_NAMES[current] })}
        aria-busy={pending !== null}
        onPointerEnter={prefetchOthers}
        onFocus={prefetchOthers}
        className={cn(
          "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-full border border-field bg-transparent pr-3.5 pl-4 text-[15px] text-ink",
          "transition-colors duration-200 hover:border-ink-2 data-[state=open]:border-ink-2 motion-reduce:transition-none",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[3px] focus-visible:outline-ink",
          className,
        )}
      >
        <Icon aria-hidden className={cn("size-4 text-ink-2", pending && "animate-spin motion-reduce:animate-none")} />
        <span lang={current}>{LOCALE_NAMES[current]}</span>
        <ChevronDown aria-hidden className="size-4 text-ink-2" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={8} className={cn(MENU_CONTENT, "w-52", fontText.variable)}>
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
