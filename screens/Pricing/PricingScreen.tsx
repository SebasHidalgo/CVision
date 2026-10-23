import Link from "next/link";
import { Check } from "lucide-react";
import SignInCta from "@/components/auth/SignInCta";
import SignInCtaButton from "@/components/auth/SignInCtaButton";
import CheckoutButton from "@/components/billing/CheckoutButton";
import ManageSubscriptionButton from "@/components/billing/ManageSubscriptionButton";
import Eyebrow from "@/components/layout/Eyebrow";
import PageIntro from "@/components/layout/PageIntro";
import { Button } from "@/components/ui/button";
import { getOptionalUserId } from "@/lib/auth";
import { CATALOG, PLAN_PROMISES } from "@/lib/billing/catalog";
import { usageSummary } from "@/lib/database/usage";
import { Footer } from "@/components/layout/Footer";

/**
 * Free and Pro side by side, with exactly the promises the plans make and
 * the prices the catalog sells at: one source, so the page and the checkout
 * cannot disagree. A visitor is sent to sign up; a Free member to the
 * checkout; a Pro member to the portal. Pro's analyses are "unlimited":
 * the fair-use cap is never shown here.
 */
export default async function PricingScreen() {
  const userId = await getOptionalUserId();
  const summary = userId ? await usageSummary(userId) : null;
  const plan = summary?.plan ?? null;

  return (
    <>
      <div className="wrap py-12 lg:py-16">
        <PageIntro
          eyebrow="Pricing"
          title="Two plans. One is free."
          lede="Check your own CV against the jobs you want, and practice the interview out loud with an AI interviewer. Pay only when you want more interviews."
        />

        <div className="grid gap-8 pt-10 lg:grid-cols-2 lg:gap-12 lg:pt-14">
          <PlanColumn
            name="Free"
            price="$0"
            cadence="forever"
            promises={PLAN_PROMISES.FREE}
            action={
              plan === null ? (
                <SignInCta mode="signUp" forceRedirectUrl="/resume/upload">
                  <Button size="lg" variant="outline" className="h-12 px-6 text-base">
                    Start free
                  </Button>
                </SignInCta>
              ) : (
                <p className="eyebrow pt-3">{plan === "FREE" ? "Your current plan" : "Included in Pro"}</p>
              )
            }
          />
          <PlanColumn
            name="Pro"
            price={CATALOG.pro_monthly.amountLabel}
            cadence="per month"
            promises={PLAN_PROMISES.PRO}
            highlighted
            action={
              plan === null ? (
                <SignInCtaButton mode="signUp" forceRedirectUrl="/pricing" className="group h-12 px-6 text-base" arrow>
                  Sign up for Pro
                </SignInCtaButton>
              ) : plan === "FREE" ? (
                <CheckoutButton item="pro_monthly" label={`Get Pro · ${CATALOG.pro_monthly.amountLabel} a month`} className="h-12 px-6 text-base" />
              ) : (
                <div className="flex flex-col items-start gap-3">
                  {/* A comped Pro has no customer at the provider yet: nothing to manage there. */}
                  {summary?.hasBillingAccount ? (
                    <ManageSubscriptionButton />
                  ) : (
                    <p className="eyebrow pt-3">Your current plan</p>
                  )}
                  <Link href="/account/billing" className="link-rule text-sm text-ink-2">
                    Plan &amp; billing
                  </Link>
                </div>
              )
            }
          />
        </div>

        <p className="mt-12 max-w-2xl text-sm leading-relaxed text-ink-2">
          Prices in USD. Payments are handled by Paddle, the merchant of record, which collects any applicable tax at checkout. Cancel any time
          from your account; Pro stays active until the end of the period you paid for. See the{" "}
          <Link href="/refunds" className="link-rule text-ink">
            refund policy
          </Link>{" "}
          and the{" "}
          <Link href="/terms" className="link-rule text-ink">
            terms
          </Link>
          .
        </p>
      </div>
      <Footer />
    </>
  );
}

type PlanColumnProps = {
  name: string;
  price: string;
  cadence: string;
  promises: readonly string[];
  action: React.ReactNode;
  highlighted?: boolean;
};

function PlanColumn({ name, price, cadence, promises, action, highlighted = false }: PlanColumnProps) {
  return (
    <section
      aria-labelledby={`plan-${name}`}
      className={highlighted ? "border border-ink p-8 lg:p-10" : "border border-line p-8 lg:p-10"}
    >
      <Eyebrow tick={highlighted}>{name}</Eyebrow>
      <h2 id={`plan-${name}`} className="mt-5 flex items-baseline gap-2">
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
