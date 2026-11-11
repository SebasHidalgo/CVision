import Link from "next/link";
import { Check } from "lucide-react";
import SignInCta from "@/components/auth/SignInCta";
import SignInCtaButton from "@/components/auth/SignInCtaButton";
import CheckoutButton from "@/components/billing/CheckoutButton";
import ManageSubscriptionButton from "@/components/billing/ManageSubscriptionButton";
import ClientMessages from "@/components/i18n/ClientMessages";
import RichText from "@/components/i18n/RichText";
import Eyebrow from "@/components/layout/Eyebrow";
import { Footer } from "@/components/layout/Footer";
import PageIntro from "@/components/layout/PageIntro";
import { Button } from "@/components/ui/button";
import { getOptionalUserId } from "@/lib/auth";
import { CATALOG, CATALOG_CURRENCY } from "@/lib/billing/catalog";
import type { PriceKey } from "@/lib/billing/types";
import { usageSummary } from "@/lib/database/usage";
import { formatMoney } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { MERCHANT_OF_RECORD } from "@/lib/legal";
import { INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS } from "@/lib/plans";

// The billing buttons are client components that read this namespace.
const BILLING_CLIENT_NS = ["billing"] as const;

/**
 * Free and Pro side by side, with exactly the promises the plans make and
 * the prices the catalog sells at: one source, so the page and the checkout
 * cannot disagree. A visitor is sent to sign up; a Free member to the
 * checkout; a Pro member to the portal. Pro's analyses are "unlimited":
 * the fair-use cap is never shown here.
 */
export default async function PricingScreen() {
  const userId = await getOptionalUserId();
  const [summary, t, common, locale] = await Promise.all([
    userId ? usageSummary(userId) : null,
    getT("pricing"),
    getT("common"),
    getLocale(),
  ]);
  const plan = summary?.plan ?? null;
  const price = (key: PriceKey) => formatMoney(Number(CATALOG[key].amountMinor) / 100, CATALOG_CURRENCY, locale);
  const proPrice = price("pro_monthly");

  // Exactly the owner's table, nothing more, with every figure from the limits the product enforces.
  const freePromises = [
    t("free.promises.analyses", { count: PLANS.FREE.analysesPerMonth }),
    t("free.promises.trial", { minutes: INTERVIEW_TIERS.TRIAL.seconds / 60 }),
    PLANS.FREE.historyLimit === null
      ? t("pro.promises.history")
      : t("free.promises.history", { count: PLANS.FREE.historyLimit }),
  ];
  const proPromises = [
    t("pro.promises.unlimited"),
    t("pro.promises.interviews", { count: PLANS.PRO.interviewsPerMonth, minutes: INTERVIEW_TIERS.FULL.seconds / 60 }),
    t("pro.promises.packs", { credits: INTERVIEW_PACK_CREDITS, price: price("interview_pack") }),
    t("pro.promises.history"),
  ];

  return (
    <>
      <div className="wrap py-12 lg:py-16">
        <PageIntro eyebrow={t("intro.eyebrow")} title={t("intro.title")} lede={t("intro.lede")} />

        <div className="grid gap-8 pt-10 lg:grid-cols-2 lg:gap-12 lg:pt-14">
          <PlanColumn
            id="free"
            name={common("plan.FREE")}
            price={formatMoney(0, CATALOG_CURRENCY, locale)}
            cadence={t("free.cadence")}
            promises={freePromises}
            action={
              plan === null ? (
                <SignInCta mode="signUp" forceRedirectUrl="/resume/upload">
                  <Button size="lg" variant="outline" className="h-12 px-6 text-base">
                    {t("free.start")}
                  </Button>
                </SignInCta>
              ) : (
                <p className="eyebrow pt-3">{plan === "FREE" ? t("currentPlan") : t("free.includedInPro")}</p>
              )
            }
          />
          <PlanColumn
            id="pro"
            name={common("plan.PRO")}
            price={proPrice}
            cadence={t("pro.cadence")}
            promises={proPromises}
            highlighted
            action={
              plan === null ? (
                <SignInCtaButton mode="signUp" forceRedirectUrl="/pricing" className="group h-12 px-6 text-base" arrow>
                  {t("pro.signUp")}
                </SignInCtaButton>
              ) : plan === "FREE" ? (
                <ClientMessages ns={BILLING_CLIENT_NS}>
                  <CheckoutButton item="pro_monthly" label={t("pro.checkout", { price: proPrice })} className="h-12 px-6 text-base" />
                </ClientMessages>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  {/* A comped Pro has no customer at the provider yet: nothing to manage there. */}
                  {summary?.hasBillingAccount ? (
                    <ClientMessages ns={BILLING_CLIENT_NS}>
                      <ManageSubscriptionButton />
                    </ClientMessages>
                  ) : (
                    <p className="eyebrow pt-3">{t("currentPlan")}</p>
                  )}
                  <Link href="/account/billing" className="link-rule text-sm text-ink-2">
                    {common("nav.planBilling")}
                  </Link>
                </div>
              )
            }
          />
        </div>

        <p className="mt-12 max-w-2xl text-sm leading-relaxed text-ink-2">
          <RichText
            ns="pricing"
            i18nKey="finePrint"
            values={{ currency: CATALOG_CURRENCY, merchant: MERCHANT_OF_RECORD }}
            components={{
              refunds: <Link href="/refunds" className="link-rule text-ink" />,
              terms: <Link href="/terms" className="link-rule text-ink" />,
            }}
          />
        </p>
      </div>
      <Footer />
    </>
  );
}

type PlanColumnProps = {
  /** Stable, language-free: the heading's id. */
  id: string;
  name: string;
  price: string;
  cadence: string;
  promises: readonly string[];
  action: React.ReactNode;
  highlighted?: boolean;
};

function PlanColumn({ id, name, price, cadence, promises, action, highlighted = false }: PlanColumnProps) {
  return (
    <section
      aria-labelledby={`plan-${id}`}
      className={highlighted ? "border border-ink p-8 lg:p-10" : "border border-line p-8 lg:p-10"}
    >
      <Eyebrow tick={highlighted}>{name}</Eyebrow>
      <h2 id={`plan-${id}`} className="mt-5 flex items-baseline gap-2">
        <span className="figure text-6xl text-ink">{price}</span>
        <span className="eyebrow">{cadence}</span>
      </h2>
      <ul className="mt-8 space-y-3">
        {promises.map((promise) => (
          <li key={promise} className="flex items-start gap-3 text-ink">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-signal" />
            <span>{promise}</span>
          </li>
        ))}
      </ul>
      <div className="mt-10">{action}</div>
    </section>
  );
}
