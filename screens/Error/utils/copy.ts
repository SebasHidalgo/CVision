import en from "@/locales/en/errorPage.json";
import es from "@/locales/es/errorPage.json";
import type { Locale } from "@/lib/i18n/config";

/**
 * The error pages' words, read straight from the bundles rather than through i18next: an error boundary must render
 * when the providers are what failed, and the root one (global-error) has no providers at all. Both languages are
 * a few hundred bytes, and these boundaries load on every page, so they stay that small.
 */

export type ErrorCopyKey = "meta" | "status" | "title" | "body" | "retry" | "retrying" | "home" | "reference";
export type ErrorCopy = (key: ErrorCopyKey, values?: { digest: string }) => string;

const BUNDLES: Record<Locale, Record<ErrorCopyKey, string>> = { en, es };

/** The error pages' t: a key, with the digest filled in where the string names it. */
export function errorCopy(locale: Locale): ErrorCopy {
  const bundle = BUNDLES[locale];
  return (key, values) => (values ? bundle[key].replace("{{digest}}", values.digest) : bundle[key]);
}

/**
 * The id Next gives an error thrown on the server, to match the server's log; never the message, which can carry
 * details (an error thrown in the browser has no digest and shows none).
 */
export function digestOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("digest" in error)) return null;
  const { digest } = error as { digest: unknown };
  return typeof digest === "string" && /^[\w-]{1,64}$/.test(digest) ? digest : null;
}
