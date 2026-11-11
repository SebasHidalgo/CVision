import type { TFunction } from "i18next";
import type { Locale, Namespace } from "./config";
import { createI18n, type LocaleResources } from "./instance";
import { RESOURCES } from "./resources";

// Tests only: a t function for a namespace and locale, from the real resource files.
export function tFor<N extends Namespace>(ns: N, locale: Locale = "en"): TFunction<N> {
  return createI18n(locale, RESOURCES[locale] as LocaleResources).getFixedT(locale, ns) as TFunction<N>;
}
