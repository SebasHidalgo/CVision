import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

// Which language a request gets. Pure; the server reads the inputs (lib/i18n/server.ts).

/**
 * The browser's preference among the locales we have: the highest-ranked `es*` or `en*` entry.
 * "es-MX,es;q=0.9" → es; "fr,es;q=0.8,en;q=0.7" → es; "fr,en;q=0.8,es;q=0.7" → en; none → en.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(param)?.[1]).find(Boolean);
      return { primary: tag.trim().toLowerCase().split("-")[0], q: q === undefined ? 1 : Number(q), order };
    })
    .filter((entry) => entry.primary && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  const match = ranked.find((entry) => isLocale(entry.primary));
  return match ? (match.primary as Locale) : DEFAULT_LOCALE;
}

export type LocaleInputs = {
  /** `User.locale` of the signed-in user; null when signed out or never chosen. */
  saved: string | null | undefined;
  /** The `locale` cookie. */
  cookie: string | null | undefined;
  acceptLanguage: string | null | undefined;
};

/** The saved choice, then the cookie, then the browser. Unknown values are skipped, never trusted. */
export function resolveLocale({ saved, cookie, acceptLanguage }: LocaleInputs): Locale {
  if (isLocale(saved)) return saved;
  if (isLocale(cookie)) return cookie;
  return localeFromAcceptLanguage(acceptLanguage);
}
