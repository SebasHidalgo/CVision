import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { TFunction } from "i18next";
import { savedLocale } from "@/lib/database/locale";
import { LOCALE_COOKIE, NAMESPACES, type Locale, type Namespace } from "./config";
import { createI18n, type LocaleResources } from "./instance";
import { pickResources, RESOURCES } from "./resources";
import { resolveLocale } from "./resolve";

/**
 * The request's language: the signed-in user's saved choice, then the `locale` cookie, then
 * Accept-Language. Memoized per request by React's cache, so a page and its layout read it once.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const [saved, cookieStore, headerList] = await Promise.all([savedLocale(), cookies(), headers()]);
  return resolveLocale({
    saved,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerList.get("accept-language"),
  });
});

// One instance per request and locale, never shared between requests.
const instanceFor = cache((locale: Locale) => createI18n(locale, RESOURCES[locale] as LocaleResources));

/** A t function bound to a namespace, in the request's language unless one is given. */
export async function getT<N extends Namespace>(ns: N, locale?: Locale): Promise<TFunction<N>> {
  const lng = locale ?? (await getLocale());
  return instanceFor(lng).getFixedT(lng, ns) as TFunction<N>;
}

/** The request's instance, for helpers that need more than t (Trans on the server). */
export async function getI18n(locale?: Locale) {
  const lng = locale ?? (await getLocale());
  return instanceFor(lng);
}

/** The resources a client subtree needs, in the request's language. */
export async function clientResources(namespaces: readonly Namespace[]): Promise<{ locale: Locale; resources: LocaleResources }> {
  const locale = await getLocale();
  return { locale, resources: pickResources(locale, namespaces) };
}

export { NAMESPACES };
