// The locales and namespaces of the interface. Import-free: client components, scripts and tests read it.

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** The visitor's explicit choice; written by the switcher, read on every request. */
export const LOCALE_COOKIE = "locale";

/** A year: the choice outlives a session. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** One file per namespace and locale under locales/. */
export const NAMESPACES = [
  "common",
  "errors",
  "landing",
  "pricing",
  "account",
  "billing",
  "upload",
  "analysis",
  "interview",
  "feedback",
  "legal",
  "sentences",
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** Namespaces every page's client components may read; anything else is passed per screen. */
export const GLOBAL_CLIENT_NAMESPACES = ["common", "errors"] as const satisfies readonly Namespace[];

/** The tag Intl formats with: neutral Latin American Spanish, US English. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-419" };

/** Each language named in itself, for the switcher. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
