import type { TFunction } from "i18next";
import Link from "next/link";
import { formatLongDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import type { PlanLine as PlanLineData, PlanPart } from "../utils/planLine";

function partText(part: PlanPart, t: TFunction<"interview">, locale: Locale): string {
  switch (part.key) {
    case "period":
      return t("list.plan.period", { count: part.count, limit: part.limit });
    case "credits":
      return t("list.plan.credits", { count: part.count });
    case "resets":
      return t("list.plan.resets", { date: formatLongDate(part.resetsAt, locale) });
    case "trial":
      return t("list.plan.trial", { minutes: part.minutes });
    case "creditsFree":
      return t("list.plan.creditsFree", { count: part.count, minutes: part.minutes });
    case "periodUsed":
      return t("list.plan.periodUsed", { date: formatLongDate(part.resetsAt, locale) });
    case "needsPro":
      return t("list.plan.needsPro");
  }
}

const LINK = "inline-flex min-h-11 items-center text-ed-ink underline decoration-ed-ink-3 underline-offset-4 hover:decoration-ed-ink";

/** Under the heading: the plan, what it has left to rehearse with, and the way to more when nothing is. */
export function PlanLine({ line, t, common, locale }: { line: PlanLineData; t: TFunction<"interview">; common: TFunction<"common">; locale: Locale }) {
  return (
    <div data-plan-line className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <p className="ed-cap">
        {t("list.plan.label")} · {common(`plan.${line.plan}`)}
      </p>
      <p className="text-ed-body text-ed-ink">{line.parts.map((part) => partText(part, t, locale)).join(" · ")}</p>
      {line.link === "getMore" && (
        <Link href="/account/billing" className={LINK}>
          {t("list.plan.getMore")}
        </Link>
      )}
      {line.link === "seePro" && (
        <Link href="/pricing" className={LINK}>
          {t("list.plan.seePro")}
        </Link>
      )}
    </div>
  );
}
