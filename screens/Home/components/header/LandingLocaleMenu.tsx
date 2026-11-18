"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, Globe, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fontText } from "@/components/design-system/fonts";
import { useLocaleSwitch } from "@/hooks/useLocaleSwitch";
import { isLocale, LOCALE_NAMES, LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/** The language menu of the landing: saves the choice, then reloads so the page's entrance plays again. */
export function LandingLocaleMenu({ className }: { className?: string }) {
  const { t } = useTranslation("common");
  const { current, pending, switchTo } = useLocaleSwitch({ reload: true });
  const Icon = pending ? Loader2 : Globe;

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger
        aria-label={t("locale.current", { code: current.toUpperCase(), language: LOCALE_NAMES[current] })}
        aria-busy={pending !== null}
        data-testid="landing-locale"
        className={cn(
          "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-ed-ink-2 transition-colors duration-200 hover:text-ed-ink data-[state=open]:text-ed-ink",
          className,
        )}
      >
        <Icon aria-hidden className={cn("size-4", pending && "animate-spin motion-reduce:animate-none")} />
        <span className="ed-mono text-[12px] font-medium uppercase tracking-wider">{current}</span>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={10}
          className={cn("ed-surface z-50 w-48 p-1.5 font-ed-text text-ed-ink", fontText.variable)}
        >
          <DropdownMenuPrimitive.Label className="ed-cap px-2.5 pt-1.5 pb-2">{t("locale.label")}</DropdownMenuPrimitive.Label>
          <DropdownMenuPrimitive.RadioGroup value={current} onValueChange={(value) => isLocale(value) && switchTo(value)}>
            {LOCALES.map((locale) => (
              <DropdownMenuPrimitive.RadioItem
                key={locale}
                value={locale}
                lang={locale}
                className="relative flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[6px] px-2.5 text-[14.5px] text-ed-ink-2 outline-hidden select-none focus:bg-ed-raise focus:text-ed-ink data-[state=checked]:font-medium data-[state=checked]:text-ed-ink"
              >
                {LOCALE_NAMES[locale]}
                <DropdownMenuPrimitive.ItemIndicator>
                  <Check aria-hidden className="size-4" />
                </DropdownMenuPrimitive.ItemIndicator>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
