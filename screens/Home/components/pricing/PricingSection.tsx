"use client";

import { useTranslation } from "react-i18next";
import { SectionHeading } from "@/components/design-system/SectionHeading";
import { PackAddon } from "./PackAddon";
import { PaymentNote } from "./PaymentNote";
import { PlanStack } from "./PlanStack";
import { PriceTable } from "./PriceTable";
import { usePricing } from "./usePricing";

/**
 * 04: Free and Pro, as a table from 640 px and stacked plans below it, then the pack and the payment note. Every
 * figure comes from lib/plans.ts and lib/billing/catalog.ts. Needs `landingPricing` and `common` on the client.
 */
export function PricingSection() {
  const { t } = useTranslation("landingPricing");
  const pricing = usePricing();
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="pt-ed-section">
      <div className="ed-wrap">
        <SectionHeading
          n="04"
          id="pricing-heading"
          title={t("title")}
          lede={<p>{t("lede", { currency: pricing.currency })}</p>}
        />
        <PriceTable pricing={pricing} className="max-sm:hidden" />
        <PlanStack pricing={pricing} className="sm:hidden" />
        <PackAddon pack={pricing.pack} />
        <PaymentNote />
      </div>
    </section>
  );
}
