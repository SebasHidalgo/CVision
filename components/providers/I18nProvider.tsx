"use client";

import { useLayoutEffect, useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { i18n as I18n } from "i18next";
import type { Locale } from "@/lib/i18n/config";
import { createI18n, type LocaleResources } from "@/lib/i18n/instance";

type I18nProviderProps = {
  locale: Locale;
  /** Only the namespaces the client needs everywhere; screens add theirs with I18nNamespaces. */
  resources: LocaleResources;
  children: React.ReactNode;
};

/** Adds bundles the instance lacks. Idempotent, so it may run during render. */
function addBundles(i18n: I18n, locale: Locale, resources: LocaleResources) {
  for (const [ns, bundle] of Object.entries(resources)) {
    if (bundle && !i18n.hasResourceBundle(locale, ns)) i18n.addResourceBundle(locale, ns, bundle, true, true);
  }
}

/**
 * The client's instance: one per mount (per request on the server render), never a module singleton.
 * It outlives a language switch: the switcher changes its language, and a server re-render in the
 * new language only adds bundles, so no client state is lost.
 */
export default function I18nProvider({ locale, resources, children }: I18nProviderProps) {
  const [i18n] = useState(() => createI18n(locale, resources));
  addBundles(i18n, locale, resources);
  // A re-render in another language (this tab's switch, or a cookie set in another tab) follows it.
  useLayoutEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [i18n, locale]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

type I18nNamespacesProps = {
  locale: Locale;
  resources: LocaleResources;
  children: React.ReactNode;
};

/** Adds a screen's namespaces to the provider's instance before its client children render. Idempotent. */
export function I18nNamespaces({ locale, resources, children }: I18nNamespacesProps) {
  const { i18n } = useTranslation();
  addBundles(i18n, locale, resources);
  return <>{children}</>;
}
