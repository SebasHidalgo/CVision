import { SectionHeading } from "@/components/design-system/SectionHeading";
import { PackAddon } from "@/components/pricing/PackAddon";
import { PaymentNote } from "@/components/pricing/PaymentNote";
import { PlanComparison } from "@/components/pricing/PlanComparison";
import { pricingView } from "@/components/pricing/pricingView";
import { getLocale, getT } from "@/lib/i18n/server";
import { PlanAction } from "./PlanAction";

/**
 * 04: the pricing page's own comparison, pack and payment note (components/pricing), under the section's heading,
 * with the landing's actions. Rendered on the server: no pricing words travel to the client.
 */
export async function PricingSection() {
  const [t, pricing, common, locale] = await Promise.all([getT("landingPricing"), getT("pricing"), getT("common"), getLocale()]);
  const view = pricingView({ t: pricing, common, locale });
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="pt-section">
      <div className="wrap">
        <SectionHeading n="04" id="pricing-heading" title={t("title")} lede={<p>{t("lede")}</p>} />
        <PlanComparison
          view={view}
          headingLevel={3}
          idPrefix="landing-plan"
          actions={{
            free: <PlanAction plan="free" signedOut={t("cta.free")} signedIn={t("cta.freeSignedIn")} />,
            pro: <PlanAction plan="pro" signedOut={t("cta.pro")} signedIn={t("cta.proSignedIn")} />,
          }}
        />
        <PackAddon pack={view.pack} id="landing-pack" />
        <PaymentNote />
      </div>
    </section>
  );
}
