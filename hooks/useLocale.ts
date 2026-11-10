"use client";

import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";

/** The interface language of the client tree (the provider's instance). */
export function useLocale(): Locale {
  const { i18n } = useTranslation();
  return isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}
