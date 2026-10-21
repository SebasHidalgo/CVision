import Link from "next/link";
import CheckoutButton from "@/components/billing/CheckoutButton";
import ManageSubscriptionButton from "@/components/billing/ManageSubscriptionButton";
import PageIntro from "@/components/layout/PageIntro";
import { CATALOG } from "@/lib/billing/catalog";
import type { CheckoutItem } from "@/lib/billing/types";
import { currentHasBillingAccount } from "@/lib/database/billing";
import { currentUsageSummary } from "@/lib/database/usage";
import { formatLongDate } from "@/lib/format";
import { INTERVIEW_PACK_CREDITS, PLANS } from "@/lib/plans";
import BillingActivation from "./components/BillingActivation";

type AccountBillingScreenProps = {
  /** Set by the checkout button after a completed payment: the page waits for the webhook to land it. */
  activating: CheckoutItem | null;
};

/**
 * The plan in force and what it leaves: the period's end or the scheduled
 * cancellation, the interviews left, the credits, and the two things a
 * member can do (buy a pack, manage the subscription in the provider's
 * portal). After a checkout the change arrives by webhook, so the page
 * polls until it lands instead of claiming it already has.
 */
export default async function AccountBillingScreen({ activating }: AccountBillingScreenProps) {
  const [summary, hasBillingAccount] = await Promise.all([currentUsageSummary(), currentHasBillingAccount()]);
  const { plan, source, subscription, credits, interviews } = summary;

  // What the page still waits for, if anything: Pro that has not landed, or a pack whose credits have not.
  const waiting =
    activating === "pro_monthly" && plan !== "PRO"
      ? "pro_monthly"
      : activating === "interview_pack"
        ? "interview_pack"
        : null;

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

      {waiting && (
        <div className="border-b border-line py-8">
          <BillingActivation waitingFor={waiting} seen={{ plan, credits: credits.balance }} />
        </div>
      )}

      <dl className="grid gap-8 py-10 sm:grid-cols-3 lg:py-14">
        <div>
          <dt className="eyebrow">Interviews this period</dt>
          <dd className="figure mt-3 text-5xl text-ink">
            {plan === "PRO" ? interviews.left : 0}
            <span className="eyebrow ml-2">of {plan === "PRO" ? interviews.limit : 0}</span>
          </dd>
          <p className="mt-2 text-sm text-ink-2">{plan === "PRO" ? `Resets ${periodEnd}.` : summary.trial.available ? "One free 5-minute practice interview." : "Voice interviews are part of Pro."}</p>
        </div>
        <div>
          <dt className="eyebrow">Interview credits</dt>
          <dd className="figure mt-3 text-5xl text-ink">{credits.balance}</dd>
          <p className="mt-2 text-sm text-ink-2">
            {credits.balance === 0
              ? "From packs; used after the period's interviews."
              : credits.usable
                ? "Used after the period's interviews. They never expire."
                : "Kept for you; usable again when Pro is active."}
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
        {plan === "PRO" ? (
          <CheckoutButton
            item="interview_pack"
            label={`Buy ${INTERVIEW_PACK_CREDITS} more interviews · ${CATALOG.interview_pack.amountLabel}`}
            afterCompleteHref="/account/billing?activating=interview_pack"
            size="default"
          />
        ) : (
          <CheckoutButton
            item="pro_monthly"
            label={`Get Pro · ${CATALOG.pro_monthly.amountLabel} a month`}
            afterCompleteHref="/account/billing?activating=pro_monthly"
            size="default"
          />
        )}
        {hasBillingAccount && <ManageSubscriptionButton />}
        <Link href="/pricing" className="link-rule px-2 text-sm text-ink-2">
          Compare the plans
        </Link>
      </div>

      {hasBillingAccount && (
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-2">
          &ldquo;Manage subscription&rdquo; opens Paddle, the merchant of record, in a new tab: payment method, invoices and cancellation live there.
          Cancelling keeps Pro until the end of the period you paid for.
        </p>
      )}
    </div>
  );
}
