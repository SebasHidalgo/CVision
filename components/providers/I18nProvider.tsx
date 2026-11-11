"use client";

import { useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { Locale } from "@/lib/i18n/config";
import { createI18n, type LocaleResources } from "@/lib/i18n/instance";

type I18nProviderProps = {
  locale: Locale;
  /** Only the namespaces the client needs everywhere; screens add theirs with I18nNamespaces. */
  resources: LocaleResources;
  children: React.ReactNode;
};

/** The client's instance: one per mount (per request on the server render), never a module singleton. */
export default function I18nProvider({ locale, resources, children }: I18nProviderProps) {
  const [i18n] = useState(() => createI18n(locale, resources));
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
  useState(() => {
    for (const [ns, bundle] of Object.entries(resources)) {
      if (!i18n.hasResourceBundle(locale, ns)) i18n.addResourceBundle(locale, ns, bundle, true, true);
    }
    return null;
  });
  return <>{children}</>;
}
