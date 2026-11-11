"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { i18n as I18n } from "i18next";
import { toast } from "sonner";
import { loadMessagesAction } from "@/components/i18n/actions/loadMessagesAction";
import { setLocaleAction } from "@/components/i18n/actions/setLocaleAction";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { useLocale } from "@/hooks/useLocale";
import { isLocale, NAMESPACES, type Locale, type Namespace } from "@/lib/i18n/config";

// One load per instance, language and namespace set: a hover and the click that follows share it.
const loads = new WeakMap<I18n, Map<string, Promise<void>>>();

/** Adds the other language's bundles for every namespace the page already shows. */
function ensureBundles(i18n: I18n, locale: Locale): Promise<void> {
  const shown = Object.keys(i18n.store.data[i18n.language] ?? {}).filter((ns): ns is Namespace =>
    (NAMESPACES as readonly string[]).includes(ns),
  );
  const missing = shown.filter((ns) => !i18n.hasResourceBundle(locale, ns));
  if (missing.length === 0) return Promise.resolve();
  const key = `${locale}:${missing.sort().join(",")}`;
  const byInstance = loads.get(i18n) ?? new Map<string, Promise<void>>();
  loads.set(i18n, byInstance);
  const known = byInstance.get(key);
  if (known) return known;
  const load = loadMessagesAction({ locale, namespaces: missing }).then((result) => {
    if (!result.ok) throw new Error(result.code);
    for (const [ns, bundle] of Object.entries(result.data.resources)) {
      if (bundle && !i18n.hasResourceBundle(locale, ns)) i18n.addResourceBundle(locale, ns, bundle, true, true);
    }
  });
  // A failed load may be retried by the next hover or click.
  load.catch(() => byInstance.delete(key));
  byInstance.set(key, load);
  return load;
}

/**
 * Switches the interface language in place: client strings at once (their bundles are prefetched on
 * intent), then the server's re-render of the page, with no reload, so scroll and form state stay.
 */
export function useLocaleSwitch() {
  const { i18n } = useTranslation();
  const current = useLocale();
  const router = useRouter();
  const errorCopy = useErrorCopy();
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<Locale | null>(null);

  const prefetch = useCallback(
    (locale: Locale) => {
      if (locale !== i18n.language) ensureBundles(i18n, locale).catch(() => undefined);
    },
    [i18n],
  );

  const switchTo = useCallback(
    (locale: Locale) => {
      if (locale === i18n.language || target) return;
      const previous = isLocale(i18n.language) ? i18n.language : null;
      const revert = async () => {
        if (!previous) return;
        await i18n.changeLanguage(previous);
        document.documentElement.lang = previous;
      };
      setTarget(locale);
      startTransition(async () => {
        try {
          await ensureBundles(i18n, locale);
          await i18n.changeLanguage(locale);
          document.documentElement.lang = locale;
          const result = await setLocaleAction({ locale });
          if (!result.ok) {
            await revert();
            toast.error(errorCopy(result.code, result.meta));
            return;
          }
          // The server components re-render in the new language; the old text stays until they arrive.
          startTransition(() => router.refresh());
        } catch {
          await revert();
          toast.error(errorCopy("REQUEST_FAILED"));
        } finally {
          setTarget(null);
        }
      });
    },
    [i18n, target, router, errorCopy],
  );

  return { current, pending: isPending ? target : null, switchTo, prefetch };
}
