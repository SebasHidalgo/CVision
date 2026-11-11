"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Globe, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocaleSwitch } from "@/hooks/useLocaleSwitch";
import { isLocale, LOCALE_NAMES, LOCALES } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

type LocaleMenuProps = {
  /** `compact`: globe and code, for the header. `full`: the language's name, for a settings row. */
  variant?: "compact" | "full";
  className?: string;
};

/**
 * The interface language as a menu: every locale named in its own language, the current one
 * checked. The other languages' strings are fetched on intent (hover, focus, opening), so the
 * switch itself is immediate.
 */
export default function LocaleMenu({ variant = "compact", className }: LocaleMenuProps) {
  const { t } = useTranslation("common");
  const { current, pending, switchTo, prefetch } = useLocaleSwitch();

  const prefetchOthers = () => {
    for (const locale of LOCALES) if (locale !== current) prefetch(locale);
  };

  const Icon = pending ? Loader2 : Globe;

  return (
    <DropdownMenu onOpenChange={(open) => open && prefetchOthers()}>
      <DropdownMenuTrigger
        aria-label={t("locale.current", { code: current.toUpperCase(), language: LOCALE_NAMES[current] })}
        aria-busy={pending !== null}
        onPointerEnter={prefetchOthers}
        onFocus={prefetchOthers}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md transition-colors duration-200",
          variant === "compact"
            ? "h-9 gap-1.5 px-2.5 text-ink-2 hover:bg-paper-2 hover:text-ink data-[state=open]:bg-paper-2 data-[state=open]:text-ink"
            : "h-10 gap-2 border border-line-strong px-3 text-sm text-ink hover:bg-paper-2 data-[state=open]:bg-paper-2",
          className,
        )}
      >
        <Icon aria-hidden className={cn("size-4", pending && "animate-spin")} />
        {variant === "compact" ? (
          <span className="font-mono text-[11px] font-medium uppercase tracking-wider">{current}</span>
        ) : (
          <>
            <span lang={current}>{LOCALE_NAMES[current]}</span>
            <ChevronDown aria-hidden className="size-4 text-ink-3" />
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={12} className="w-48 rounded-md border-line-strong p-1.5 shadow-float">
        {/* The size again: the base label's text-sm would otherwise win over the eyebrow's. */}
        <DropdownMenuLabel className="eyebrow px-2.5 pt-1.5 pb-2 text-[0.6875rem] font-normal">{t("locale.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => isLocale(value) && switchTo(value)}>
          {LOCALES.map((locale) => (
            <DropdownMenuPrimitive.RadioItem
              key={locale}
              value={locale}
              lang={locale}
              className="relative flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-sm text-ink-2 outline-hidden select-none focus:bg-paper-2 focus:text-ink data-[state=checked]:font-medium data-[state=checked]:text-ink"
            >
              {LOCALE_NAMES[locale]}
              <DropdownMenuPrimitive.ItemIndicator>
                <Check aria-hidden className="size-4 text-signal" />
              </DropdownMenuPrimitive.ItemIndicator>
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
