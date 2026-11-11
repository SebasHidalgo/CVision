import Link from "next/link";
import { Loader2 } from "lucide-react";
import CheckoutButton from "@/components/billing/CheckoutButton";
import ManageSubscriptionButton from "@/components/billing/ManageSubscriptionButton";
import ClientMessages from "@/components/i18n/ClientMessages";
import LocaleSwitcher from "@/components/i18n/LocaleSwitcher";
import PageIntro from "@/components/layout/PageIntro";
import { Button } from "@/components/ui/button";
import type { Activation } from "@/lib/billing/activation";
import { CATALOG, CATALOG_CURRENCY } from "@/lib/billing/catalog";
import { currentTransactionApplied, currentUsageSummary } from "@/lib/database/usage";
import { formatLongDate, formatMoney } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS } from "@/lib/plans";
import BillingActivation from "./components/BillingActivation";

type AccountBillingScreenProps = {
  /** Set by the checkout button after a completed payment: the page waits for that transaction's webhook. */
  activation: Activation | null;
};

const TRIAL_MINUTES = INTERVIEW_TIERS.TRIAL.seconds / 60;
const FULL_MINUTES = INTERVIEW_TIERS.FULL.seconds / 60;

/**
 * The plan in force and what it leaves: the period's end or the scheduled
 * cancellation, the interviews left, the credits, and the two things a
 * member can do (buy a pack, manage the subscription in the provider's
 * portal). After a checkout the change arrives by webhook, so the page
 * polls for that transaction until it lands instead of claiming it already
 * has; while it waits, the checkout button is out of reach. Last, the
 * interface language, saved to the account.
 */
export default async function AccountBillingScreen({ activation }: AccountBillingScreenProps) {
  const [summary, applied, t, common, locale] = await Promise.all([
    currentUsageSummary(),
    activation ? currentTransactionApplied(activation.transactionId) : Promise.resolve(false),
    getT("account"),
    getT("common"),
    getLocale(),
  ]);
  const { plan, source, subscription, credits, interviews, hasBillingAccount } = summary;
  const pro = plan === "PRO";

  const periodEnd = formatLongDate(summary.resetsAt, locale);
  const cancelsAt = subscription?.cancelAtPeriodEnd && subscription.scheduledChangeAt ? formatLongDate(subscription.scheduledChangeAt, locale) : null;
  const price = (item: keyof typeof CATALOG) => formatMoney(Number(CATALOG[item].amountMinor) / 100, CATALOG_CURRENCY, locale);

  const planLine = pro
    ? source === "comp"
      ? t("planLine.comp")
      : cancelsAt
        ? t("planLine.cancels", { date: cancelsAt })
        : subscription?.status === "PAST_DUE"
          ? t("planLine.pastDue", { date: periodEnd })
          : t("planLine.renews", { date: periodEnd })
    : subscription?.status === "CANCELED"
      ? t("planLine.canceled")
      : subscription?.status === "PAUSED"
        ? t("planLine.paused")
        : t("planLine.free");

  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro eyebrow={t("intro.eyebrow")} title={pro ? t("intro.titlePro") : t("intro.titleFree")} lede={planLine} />

      {activation && (
        <div className="border-b border-line py-8">
          <ClientMessages ns={["account"]}>
            <BillingActivation activation={activation} applied={applied} />
          </ClientMessages>
        </div>
      )}

      <dl className="grid gap-8 py-10 sm:grid-cols-3 lg:py-14">
        <div>
          <dt className="eyebrow">{t("interviews.label")}</dt>
          <dd className="figure mt-3 text-5xl text-ink">
            {pro ? interviews.left : 0}
            <span className="eyebrow ml-2">{t("interviews.of", { limit: pro ? interviews.limit : 0 })}</span>
          </dd>
          <p className="mt-2 text-sm text-ink-2">
            {pro
              ? t("interviews.resets", { date: periodEnd })
              : summary.trial.available
                ? t("interviews.trial", { minutes: TRIAL_MINUTES })
                : credits.balance > 0
                  ? t("interviews.creditsCover", { perMonth: PLANS.PRO.interviewsPerMonth })
                  : t("interviews.proOnly")}
          </p>
        </div>
        <div>
          <dt className="eyebrow">{t("credits.label")}</dt>
          <dd className="figure mt-3 text-5xl text-ink">{credits.balance}</dd>
          <p className="mt-2 text-sm text-ink-2">
            {credits.balance === 0
              ? t("credits.none", { size: INTERVIEW_PACK_CREDITS })
              : pro
                ? t("credits.pro")
                : t("credits.free", { minutes: FULL_MINUTES })}
          </p>
          {credits.pending > 0 && (
            <p className="mt-2 text-sm text-ink-2" role="status">
              {t("credits.pending", { count: credits.pending })}
            </p>
          )}
        </div>
        <div>
          <dt className="eyebrow">{t("analyses.label")}</dt>
          <dd className="figure mt-3 text-5xl text-ink">
            {pro ? "∞" : summary.analyses.left}
            {!pro && <span className="eyebrow ml-2">{t("analyses.ofMonth", { limit: PLANS.FREE.analysesPerMonth })}</span>}
          </dd>
          <p className="mt-2 text-sm text-ink-2">{pro ? t("analyses.pro") : t("analyses.free", { limit: PLANS.FREE.historyLimit ?? 0 })}</p>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-10">
        {activation ? (
          <Button disabled size="default" className="gap-2">
            <Loader2 className="size-4 animate-spin" />
            {t("actions.confirming")}
          </Button>
        ) : pro ? (
          <CheckoutButton
            item="interview_pack"
            label={t("actions.buyPack", { count: INTERVIEW_PACK_CREDITS, price: price("interview_pack") })}
            size="default"
          />
        ) : (
          <CheckoutButton item="pro_monthly" label={t("actions.getPro", { price: price("pro_monthly") })} size="default" />
        )}
        {hasBillingAccount && <ManageSubscriptionButton />}
        <Link href="/pricing" className="link-rule px-2 text-sm text-ink-2">
          {t("actions.compare")}
        </Link>
      </div>

      {hasBillingAccount && <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-2">{t("portalNote")}</p>}

      <section aria-labelledby="account-language-title" className="mt-16 border-t border-line pt-10 lg:mt-20">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <h2 id="account-language-title" className="eyebrow">
              {common("locale.accountTitle")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">{common("locale.accountBody")}</p>
          </div>
          <LocaleSwitcher className="self-start md:self-auto" />
        </div>
      </section>
    </div>
  );
}
