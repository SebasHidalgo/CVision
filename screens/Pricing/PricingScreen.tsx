import type { TFunction } from "i18next";
import CheckoutButton from "@/components/billing/CheckoutButton";
import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { PackAddon } from "@/components/pricing/PackAddon";
import { PaymentNote } from "@/components/pricing/PaymentNote";
import { PlanComparison, type PlanStanding } from "@/components/pricing/PlanComparison";
import { catalogPrice, FULL_MINUTES, PACK_CREDITS, pricingView, TRIAL_MINUTES } from "@/components/pricing/pricingView";
import { getOptionalUserId } from "@/lib/auth";
import { currentOpenSubscriptionStatus, usageSummary } from "@/lib/database/usage";
import { formatLongDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { getLocale, getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { ACTION_WRAP, PricingAction } from "./components/PricingAction";
import { factsFromSummary, pricingState, type StandingSpec } from "./utils/planState";

/**
 * Free and Pro, the same comparison as the landing's (components/pricing), with the reader's standing and the action
 * that fits it: sign up for a visitor, the checkout for Free, the portal for a subscription, the pack for Pro. Every
 * figure comes from lib/plans.ts and the catalog, so the page and the checkout cannot disagree.
 */
export default async function PricingScreen() {
  const userId = await getOptionalUserId();
  const [summary, openSubscription, t, common, locale] = await Promise.all([
    userId ? usageSummary(userId) : null,
    userId ? currentOpenSubscriptionStatus() : null,
    getT("pricing"),
    getT("common"),
    getLocale(),
  ]);
  const state = pricingState(summary ? factsFromSummary(summary, openSubscription) : { signedIn: false });
  const view = pricingView({ t, common, locale });
  const proPrice = catalogPrice("pro_monthly", locale);

  return (
    <div className={cn("ed-root flex-1", fontText.variable)} data-pricing-state={state.kind}>
      <div className="ed-wrap pt-[clamp(40px,6vw,88px)] pb-ed-section">
        <PageHeading title={t("intro.title")} lede={t("intro.lede")} ruled />
        <div className="mt-10 lg:mt-12">
          <PlanComparison
            view={view}
            headingLevel={2}
            idPrefix="pricing-plan"
            standing={{ free: standingText(state.free.standing, t, locale), pro: standingText(state.pro.standing, t, locale) }}
            actions={{
              free: <PricingAction spec={state.free.action} proPrice={proPrice} t={t} common={common} />,
              pro: <PricingAction spec={state.pro.action} proPrice={proPrice} t={t} common={common} />,
            }}
          />
          <PackAddon
            pack={view.pack}
            headingLevel={2}
            held={state.pack.held > 0 ? t("pack.held", { count: state.pack.held, minutes: FULL_MINUTES }) : null}
            action={
              state.pack.checkout && (
                <CheckoutButton
                  item="interview_pack"
                  label={t("actions.buyPack", { count: PACK_CREDITS, price: catalogPrice("interview_pack", locale) })}
                  size="default"
                  className={ACTION_WRAP}
                />
              )
            }
          />
          <PaymentNote />
        </div>
      </div>
    </div>
  );
}

/** The mapper's standing in words; dates in UTC, on the server, like every period. */
function standingText(spec: StandingSpec | null, t: TFunction<"pricing">, locale: Locale): PlanStanding | null {
  if (!spec) return null;
  const date = (value: Date | undefined) => (value ? formatLongDate(value, locale) : "");
  const detail = spec.detail;
  return {
    tone: spec.tone,
    label: t(`state.mark.${spec.label}`, { date: date(spec.date) }),
    detail: detail ? t(`state.detail.${detail.key}`, { date: date("date" in detail ? detail.date : undefined), minutes: TRIAL_MINUTES }) : null,
  };
}
