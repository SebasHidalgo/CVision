import { Bone } from "@/components/design-system/Bone";
import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { PackAddon } from "@/components/pricing/PackAddon";
import { PaymentNote } from "@/components/pricing/PaymentNote";
import { PlanComparison } from "@/components/pricing/PlanComparison";
import { pricingView } from "@/components/pricing/pricingView";
import { getLocale, getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/** A pill where the reader's action will be: decorative, the status line announces the wait. */
const PENDING_ACTION = <Bone className="h-12 w-44 max-w-full rounded-full" />;

/** The plans are the same for everyone, so they show at once; only the reader's standing and actions wait. */
export default async function PricingLoading() {
  const [t, common, locale] = await Promise.all([getT("pricing"), getT("common"), getLocale()]);
  const view = pricingView({ t, common, locale });
  return (
    <div className={cn("ed-root flex-1", fontText.variable)}>
      <div className="ed-wrap pt-[clamp(40px,6vw,88px)] pb-ed-section">
        <PageHeading title={t("intro.title")} lede={t("intro.lede")} ruled />
        <p role="status" className="sr-only">
          {t("state.loading")}
        </p>
        <div className="mt-10 lg:mt-12">
          <PlanComparison view={view} headingLevel={2} idPrefix="pricing-plan" actions={{ free: PENDING_ACTION, pro: PENDING_ACTION }} />
          <PackAddon pack={view.pack} headingLevel={2} />
          <PaymentNote />
        </div>
      </div>
    </div>
  );
}
