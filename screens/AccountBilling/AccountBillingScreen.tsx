import Link from "next/link";
import { Loader2 } from "lucide-react";
import CheckoutButton from "@/components/billing/CheckoutButton";
import ManageSubscriptionButton from "@/components/billing/ManageSubscriptionButton";
import PageIntro from "@/components/layout/PageIntro";
import { Button } from "@/components/ui/button";
import type { Activation } from "@/lib/billing/activation";
import { CATALOG } from "@/lib/billing/catalog";
import { currentTransactionApplied, currentUsageSummary } from "@/lib/database/usage";
import { formatLongDate } from "@/lib/format";
import { INTERVIEW_PACK_CREDITS, PLANS } from "@/lib/plans";
import BillingActivation from "./components/BillingActivation";

type AccountBillingScreenProps = {
  /** Set by the checkout button after a completed payment: the page waits for that transaction's webhook. */
  activation: Activation | null;
};

/**
 * The plan in force and what it leaves: the period's end or the scheduled
 * cancellation, the interviews left, the credits, and the two things a
 * member can do (buy a pack, manage the subscription in the provider's
 * portal). After a checkout the change arrives by webhook, so the page
 * polls for that transaction until it lands instead of claiming it already
 * has; while it waits, the checkout button is out of reach.
 */
export default async function AccountBillingScreen({ activation }: AccountBillingScreenProps) {
  const [summary, applied] = await Promise.all([
    currentUsageSummary(),
    activation ? currentTransactionApplied(activation.transactionId) : Promise.resolve(false),
  ]);
  const { plan, source, subscription, credits, interviews, hasBillingAccount } = summary;

  const periodEnd = formatLongDate(summary.resetsAt);
  const cancelsAt = subscription?.cancelAtPeriodEnd && subscription.scheduledChangeAt ? formatLongDate(subscription.scheduledChangeAt) : null;

  const planLine =
    plan === "PRO"
      ? source === "comp"
        ? "Pro, on the house."
        : cancelsAt
          ? `Pro, until ${cancelsAt}. Your cancellation is scheduled; nothing more will be charged.`
          : subscription?.status === "PAST_DUE"
            ? `Pro. The last payment did not go through; Paddle is retrying. Update the card from "Manage subscription" to keep Pro past ${periodEnd}.`
            : `Pro, renews ${periodEnd}.`
      : subscription?.status === "CANCELED"
        ? "Free. Your Pro subscription ended; nothing was deleted, and Pro brings it all back."
        : subscription?.status === "PAUSED"
          ? "Free while your subscription is paused. Resume it from \"Manage subscription\"."
          : "Free.";

  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro eyebrow="Plan & billing" title={plan === "PRO" ? "You're on Pro." : "You're on Free."} lede={planLine} />

      {activation && (
        <div className="border-b border-line py-8">
          <BillingActivation activation={activation} applied={applied} />
        </div>
      )}

      <dl className="grid gap-8 py-10 sm:grid-cols-3 lg:py-14">
        <div>
          <dt className="eyebrow">Interviews this period</dt>
          <dd className="figure mt-3 text-5xl text-ink">
            {plan === "PRO" ? interviews.left : 0}
            <span className="eyebrow ml-2">of {plan === "PRO" ? interviews.limit : 0}</span>
          </dd>
          <p className="mt-2 text-sm text-ink-2">
            {plan === "PRO"
              ? `Resets ${periodEnd}.`
              : summary.trial.available
                ? "One free 5-minute practice interview."
                : credits.balance > 0
                  ? `Your credits cover full interviews; Pro adds ${PLANS.PRO.interviewsPerMonth} a month.`
                  : "Voice interviews are part of Pro."}
          </p>
        </div>
        <div>
          <dt className="eyebrow">Interview credits</dt>
          <dd className="figure mt-3 text-5xl text-ink">{credits.balance}</dd>
          <p className="mt-2 text-sm text-ink-2">
            {credits.balance === 0
              ? `From packs of ${INTERVIEW_PACK_CREDITS}; each one a full interview.`
              : plan === "PRO"
                ? "Used after the period's interviews. They never expire."
                : "Each one is a full 12-minute interview, on any plan. They never expire."}
          </p>
        </div>
        <div>
          <dt className="eyebrow">Analyses</dt>
          <dd className="figure mt-3 text-5xl text-ink">
            {plan === "PRO" ? "∞" : summary.analyses.left}
            {plan !== "PRO" && <span className="eyebrow ml-2">of {PLANS.FREE.analysesPerMonth} this month</span>}
          </dd>
          <p className="mt-2 text-sm text-ink-2">{plan === "PRO" ? "Unlimited CV analyses." : `Free shows your last ${PLANS.FREE.historyLimit} analyses.`}</p>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-10">
        {activation ? (
          <Button disabled size="default" className="gap-2">
            <Loader2 className="size-4 animate-spin" />
            Confirming your payment…
          </Button>
        ) : plan === "PRO" ? (
          <CheckoutButton item="interview_pack" label={`Buy ${INTERVIEW_PACK_CREDITS} more interviews · ${CATALOG.interview_pack.amountLabel}`} size="default" />
        ) : (
          <CheckoutButton item="pro_monthly" label={`Get Pro · ${CATALOG.pro_monthly.amountLabel} a month`} size="default" />
        )}
        {hasBillingAccount && <ManageSubscriptionButton />}
        <Link href="/pricing" className="link-rule px-2 text-sm text-ink-2">
          Compare the plans
        </Link>
      </div>

      {hasBillingAccount && (
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-2">
          &ldquo;Manage subscription&rdquo; opens Paddle, the merchant of record: payment method, invoices and cancellation live there.
          Cancelling keeps Pro until the end of the period you paid for.
        </p>
      )}
    </div>
  );
}
