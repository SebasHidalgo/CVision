"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "@/hooks/useLocale";
import { CATALOG, CATALOG_CURRENCY } from "@/lib/billing/catalog";
import type { PriceKey } from "@/lib/billing/types";
import { formatMoney } from "@/lib/format";
import { INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS, type PlanId } from "@/lib/plans";

export type PlanRow = { id: string; label: string; free: string; pro: string };

/** The comparison's words with every figure from the plans and the catalog, in the reader's language. */
export function usePricing() {
  const { t } = useTranslation("landingPricing");
  const { t: common } = useTranslation("common");
  const locale = useLocale();
  return useMemo(() => {
    const price = (key: PriceKey) => formatMoney(Number(CATALOG[key].amountMinor) / 100, CATALOG_CURRENCY, locale);
    const history = (plan: PlanId) => {
      const limit = PLANS[plan].historyLimit;
      return limit === null ? t("rows.history.all") : t("rows.history.last", { count: limit });
    };
    const rows: PlanRow[] = [
      {
        id: "analyses",
        label: t("rows.analyses.label"),
        free: t("rows.analyses.free", { count: PLANS.FREE.analysesPerMonth }),
        // The owner's call for the landing: Pro's fair-use cap is said as "up to".
        pro: t("rows.analyses.pro", { count: PLANS.PRO.analysesPerMonth }),
      },
      { id: "history", label: t("rows.history.label"), free: history("FREE"), pro: history("PRO") },
      {
        id: "interviews",
        label: t("rows.interviews.label"),
        free: t("rows.interviews.trial", { count: PLANS.FREE.trialInterviews, minutes: INTERVIEW_TIERS.TRIAL.seconds / 60 }),
        pro: t("rows.interviews.perMonth", { count: PLANS.PRO.interviewsPerMonth, minutes: INTERVIEW_TIERS.FULL.seconds / 60 }),
      },
    ];
    return {
      rows,
      currency: CATALOG_CURRENCY,
      plans: {
        free: { name: common("plan.FREE"), price: formatMoney(0, CATALOG_CURRENCY, locale), cadence: null },
        pro: { name: common("plan.PRO"), price: price("pro_monthly"), cadence: t("perMonth") },
      },
      pack: { credits: CATALOG.interview_pack.credits ?? INTERVIEW_PACK_CREDITS, price: price("interview_pack") },
    };
  }, [t, common, locale]);
}

export type Pricing = ReturnType<typeof usePricing>;
