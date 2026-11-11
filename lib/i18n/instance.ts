import { createInstance, type i18n as I18n, type Resource } from "i18next";
import { BRAND } from "@/lib/brand";
import { LOCALES, type Locale, type Namespace } from "./config";

/** The resources of one locale, by namespace. */
export type LocaleResources = Partial<Record<Namespace, Record<string, unknown>>>;

/**
 * A fresh i18next instance, initialized synchronously with the resources it is given. Never a
 * module-level singleton: the server makes one per request, the client one per provider mount.
 */
export function createI18n(locale: Locale, resources: LocaleResources): I18n {
  const instance = createInstance();
  void instance.init({
    lng: locale,
    fallbackLng: false,
    // Every locale: the client switches in place once it has added the other language's bundles.
    supportedLngs: [...LOCALES],
    resources: { [locale]: resources } as Resource,
    ns: Object.keys(resources),
    defaultNS: "common",
    initAsync: false,
    returnNull: false,
    // React escapes; the sentence renderer and metadata take plain text.
    interpolation: { escapeValue: false, defaultVariables: { brand: BRAND.name } },
    react: { useSuspense: false },
  });
  return instance;
}
