"use client";

import { useTranslation } from "react-i18next";
import { CATALOG, CATALOG_CURRENCY } from "@/lib/billing/catalog";
import { formatMoney } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS } from "@/lib/plans";

/** The interview's terms in four lines, every number from the plans and the catalog. */
export function Facts({ locale }: { locale: Locale }) {
  const { t } = useTranslation("landingInterview");
  const price = formatMoney(Number(CATALOG.interview_pack.amountMinor) / 100, CATALOG_CURRENCY, locale);
  const facts = [
    {
      id: "length",
      term: t("facts.length.term"),
      body: t("facts.length.body", { full: INTERVIEW_TIERS.FULL.seconds / 60, trial: INTERVIEW_TIERS.TRIAL.seconds / 60 }),
    },
    { id: "language", term: t("facts.language.term"), body: t("facts.language.body") },
    {
      id: "count",
      term: t("facts.count.term"),
      body: t("facts.count.body", { perMonth: PLANS.PRO.interviewsPerMonth, credits: INTERVIEW_PACK_CREDITS, price }),
    },
    { id: "kept", term: t("facts.kept.term"), body: t("facts.kept.body") },
  ];

  return (
    <dl className="page-grid mt-[clamp(40px,5vw,64px)] gap-y-[18px] border-t border-line pt-[18px]">
      {facts.map((f) => (
        <div key={f.id} className="min-[760px]:col-span-6 lg:col-span-3">
          <dt className="mb-1 text-cap font-semibold uppercase text-ink-2">{f.term}</dt>
          <dd className="text-[15px] text-ink">{f.body}</dd>
        </div>
      ))}
    </dl>
  );
}
