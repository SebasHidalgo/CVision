import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";

// Dates in UTC, like the quota periods (a period ends at 00:00 UTC) and the production servers, so every page agrees.
// Call the date formatters from Server Components only, with the request's locale: on the client
// they would depend on the visitor's timezone and cause hydration mismatches.

export function formatDate(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function formatLongDate(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

/** "$19" / "USD 19", whole amounts without decimals. */
export function formatMoney(amount: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** "01", "02", … for editorial numbering. */
export function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}
