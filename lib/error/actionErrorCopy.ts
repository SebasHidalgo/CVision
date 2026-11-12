import type { TFunction } from "i18next";
import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";
import { MAX_RESUME_SIZE_LABEL } from "@/lib/uploadLimits";
import type { ErrorCode, ErrorMeta } from "./errors";

// User-facing copy per error code, from locales/<locale>/errors.json. Backend messages are never rendered.

/** "Nov 1" / "1 de noviembre", from the ISO date the server put in `meta.resetsAt`. */
export function resetDateCopy(resetsAt: string, locale: Locale): string {
  // Spanish sentences say "el 1 de diciembre": the month in full, never "1 dic".
  const month = locale === "es" ? "long" : "short";
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month, day: "numeric", timeZone: "UTC" }).format(new Date(resetsAt));
}

/**
 * The copy for a code, with the few blanks `meta` fills: the reset date of
 * a quota, the wait of a rate limit, and the plan, which decides whether a
 * used-up analysis quota is the Free allowance or Pro's fair-use cap.
 */
export function actionErrorCopy(t: TFunction<"errors">, locale: Locale, code: ErrorCode, meta?: ErrorMeta): string {
  if (code === "ANALYSIS_QUOTA_EXCEEDED") {
    const pro = meta?.plan === "PRO";
    if (!meta?.resetsAt) return t(pro ? "analysisQuota.pro" : "analysisQuota.free");
    return t(pro ? "analysisQuota.proResets" : "analysisQuota.freeResets", { date: resetDateCopy(meta.resetsAt, locale) });
  }
  if (code === "INTERVIEW_QUOTA_EXCEEDED" && meta?.plan === "PRO") {
    return meta.resetsAt ? t("interviewQuota.proResets", { date: resetDateCopy(meta.resetsAt, locale) }) : t("interviewQuota.pro");
  }
  if (code === "RATE_LIMITED" && typeof meta?.retryAfter === "number") {
    const seconds = Math.max(1, Math.ceil(meta.retryAfter));
    const wait =
      seconds >= 120
        ? t("rateLimited.minutes", { count: Math.ceil(seconds / 60) })
        : seconds >= 60
          ? t("rateLimited.aMinute")
          : t("rateLimited.seconds", { count: seconds });
    return t("rateLimited.wait", { wait });
  }
  // A code this build does not know (a newer server) reads as the generic copy; i18next returns the key itself.
  const key = `codes.${code}` as `codes.${ErrorCode}`;
  const text = t(key, { size: MAX_RESUME_SIZE_LABEL });
  return text === key ? t("codes.UNKNOWN") : text;
}
