// Call from Server Components only: formatting on the client would depend on
// the visitor's timezone and cause hydration mismatches.

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const longDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function formatDate(value: string | Date): string {
  return shortDate.format(new Date(value));
}

export function formatLongDate(value: string | Date): string {
  return longDate.format(new Date(value));
}

/** "01", "02", … for editorial numbering. */
export function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}
