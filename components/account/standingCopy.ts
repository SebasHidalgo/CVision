import type { TFunction } from "i18next";
import { STANDING_SHAPE, type AccountStanding } from "@/lib/accountStanding";
import { formatLongDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { PLANS } from "@/lib/plans";
import type { MarkShape } from "./Mark";

export type StandingCopy = { shape: MarkShape; label: string; line: string };

/** The standing's mark, its short label and its sentence, in the request's language (dates in full). */
export function standingCopy(standing: AccountStanding, t: TFunction<"account">, locale: Locale): StandingCopy {
  const shape = STANDING_SHAPE[standing.kind];
  switch (standing.kind) {
    case "free":
      return {
        shape,
        label: t("standing.free"),
        line: t("planLine.free", { analyses: PLANS.FREE.analysesPerMonth }),
      };
    case "canceled":
      return { shape, label: t("standing.canceled"), line: t("planLine.canceled") };
    case "paused":
      return { shape, label: t("standing.paused"), line: t("planLine.paused") };
    case "comp":
      return { shape, label: t("standing.comp"), line: t("planLine.comp") };
    case "active":
      return { shape, label: t("standing.active"), line: t("planLine.renews", { date: formatLongDate(standing.renewsAt, locale) }) };
    case "past-due":
      // No date: Paddle's retries last days, not to the period's end.
      return { shape, label: t("standing.pastDue"), line: t("planLine.pastDue") };
    case "cancels": {
      const date = formatLongDate(standing.endsAt, locale);
      return { shape, label: t("standing.cancels", { date }), line: t("planLine.cancels", { date }) };
    }
  }
}
