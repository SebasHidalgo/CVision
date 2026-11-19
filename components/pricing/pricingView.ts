import type { TFunction } from "i18next";
import { CATALOG, CATALOG_CURRENCY } from "@/lib/billing/catalog";
import type { PriceKey } from "@/lib/billing/types";
import { formatMoney } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS, type PlanId } from "@/lib/plans";

export type PlanKey = "free" | "pro";
export const PLAN_KEYS = ["free", "pro"] as const satisfies readonly PlanKey[];

export type PricingRow = { id: "analyses" | "history" | "interviews"; label: string; free: string; pro: string };
export type PricingPlan = { name: string; price: string; cadence: string | null };

/** The comparison's words, every figure from lib/plans.ts and the catalog, in the reader's language. */
export type PricingView = {
  caption: string;
  /** The hidden header of the row that says where the reader stands. */
  standingLabel: string;
  /** The hidden header of the row of actions. */
  actionsLabel: string;
  plans: Record<PlanKey, PricingPlan>;
  rows: PricingRow[];
  pack: { label: string; lead: string; body: string };
  currency: string;
};

export const TRIAL_MINUTES = INTERVIEW_TIERS.TRIAL.seconds / 60;
export const FULL_MINUTES = INTERVIEW_TIERS.FULL.seconds / 60;
/** What one pack grants, as the catalog sells it. */
export const PACK_CREDITS = CATALOG.interview_pack.credits ?? INTERVIEW_PACK_CREDITS;

export function catalogPrice(key: PriceKey, locale: Locale): string {
  return formatMoney(Number(CATALOG[key].amountMinor) / 100, CATALOG_CURRENCY, locale);
}

/** Pure: the landing and the pricing page pass their own `t`, the same view comes back. */
export function pricingView({ t, common, locale }: { t: TFunction<"pricing">; common: TFunction<"common">; locale: Locale }): PricingView {
  const history = (plan: PlanId) => {
    const limit = PLANS[plan].historyLimit;
    return limit === null ? t("rows.history.all") : t("rows.history.last", { count: limit });
  };
  return {
    caption: t("compare.caption"),
    standingLabel: t("compare.standing"),
    actionsLabel: t("compare.actions"),
    plans: {
      free: { name: common("plan.FREE"), price: formatMoney(0, CATALOG_CURRENCY, locale), cadence: null },
      pro: { name: common("plan.PRO"), price: catalogPrice("pro_monthly", locale), cadence: t("perMonth") },
    },
    rows: [
      {
        id: "analyses",
        label: t("rows.analyses.label"),
        free: t("rows.analyses.free", { count: PLANS.FREE.analysesPerMonth }),
        pro: t("rows.analyses.pro", { count: PLANS.PRO.analysesPerMonth }),
      },
      { id: "history", label: t("rows.history.label"), free: history("FREE"), pro: history("PRO") },
      {
        id: "interviews",
        label: t("rows.interviews.label"),
        free: t("rows.interviews.trial", { count: PLANS.FREE.trialInterviews, minutes: TRIAL_MINUTES }),
        pro: t("rows.interviews.perMonth", { count: PLANS.PRO.interviewsPerMonth, minutes: FULL_MINUTES }),
      },
    ],
    pack: {
      label: t("pack.label"),
      lead: t("pack.lead", { count: PACK_CREDITS, price: catalogPrice("interview_pack", locale) }),
      body: t("pack.body"),
    },
    currency: CATALOG_CURRENCY,
  };
}
