import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AccountSection, Figure, RowNote, UsageRow } from "@/components/account/AccountSection";
import { AccountTabs } from "@/components/account/AccountTabs";
import { Mark } from "@/components/account/Mark";
import { standingCopy } from "@/components/account/standingCopy";
import CheckoutButton from "@/components/billing/CheckoutButton";
import ManageSubscriptionButton from "@/components/billing/ManageSubscriptionButton";
import { buttonClass, textLinkClass } from "@/components/design-system/Button";
import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { Surface } from "@/components/design-system/Surface";
import ClientMessages from "@/components/i18n/ClientMessages";
import { accountStanding, creditsView, offersProCheckout } from "@/lib/accountStanding";
import type { Activation } from "@/lib/billing/activation";
import { CATALOG, CATALOG_CURRENCY } from "@/lib/billing/catalog";
import { currentOpenSubscriptionStatus, currentTransactionApplied, currentUsageSummary } from "@/lib/database/usage";
import { formatMoney } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import BillingActivation from "./components/BillingActivation";

type AccountBillingScreenProps = {
  /** Set by the checkout button after a completed payment: the page waits for that transaction's webhook. */
  activation: Activation | null;
};

const FULL_MINUTES = INTERVIEW_TIERS.FULL.seconds / 60;

// A label with a price may not fit one line on the narrowest phones: the pill grows instead of overflowing.
const WRAPS = "h-auto max-w-full whitespace-normal py-2.5 text-center";

/**
 * Plan & billing: the subscription and its state, the provider's portal, and the interview packs. After a
 * checkout the change arrives by webhook, so the page polls for that transaction until it lands instead of
 * claiming it already has; while it waits, every checkout on the page is out of reach. A Pro checkout is offered
 * only where it can succeed (no open subscription), a pack only to Pro; the portal to anyone with a customer at
 * the provider. The plan's usage and the language are on the account page.
 */
export default async function AccountBillingScreen({ activation }: AccountBillingScreenProps) {
  const [summary, openSubscription, applied, t, locale] = await Promise.all([
    currentUsageSummary(),
    currentOpenSubscriptionStatus(),
    activation ? currentTransactionApplied(activation.transactionId) : Promise.resolve(false),
    getT("account"),
    getLocale(),
  ]);
  const { plan, hasBillingAccount } = summary;
  const pro = plan === "PRO";
  const standing = accountStanding(summary);
  const copy = standingCopy(standing, t, locale);
  const credits = creditsView(summary);
  const price = (item: keyof typeof CATALOG) => formatMoney(Number(CATALOG[item].amountMinor) / 100, CATALOG_CURRENCY, locale);

  // While a payment is being confirmed, no second checkout can start from this page.
  const confirming = activation && (
    <button type="button" disabled className={buttonClass({ className: "cursor-progress disabled:opacity-75 hover:translate-y-0" })}>
      <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
      {t("actions.confirming")}
    </button>
  );

  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div className="wrap pt-[clamp(40px,6vw,88px)] pb-section">
        <PageHeading title={pro ? t("intro.titlePro") : t("intro.titleFree")} />
        <AccountTabs current="billing" t={t} />

        {activation && (
          <ClientMessages ns={["account"]}>
            <Surface data-activation className="mt-8 p-6 max-sm:p-5">
              <BillingActivation activation={activation} applied={applied} />
            </Surface>
          </ClientMessages>
        )}

        <div className="mt-[clamp(8px,2vw,16px)]">
          <AccountSection n="01" id="billing-subscription" title={t("subscription.title")}>
            <p data-standing={standing.kind} className="flex items-center gap-2.5 text-body font-medium text-ink">
              <Mark shape={copy.shape} />
              {copy.label}
            </p>
            <p className="mt-3 max-w-[62ch] text-body text-ink-2">{copy.line}</p>
            {offersProCheckout(standing, openSubscription) && (
              <p className="mt-3 max-w-[62ch] text-body text-ink-2">
                {t("subscription.offer", {
                  price: price("pro_monthly"),
                  interviews: PLANS.PRO.interviewsPerMonth,
                  minutes: FULL_MINUTES,
                  analyses: PLANS.PRO.analysesPerMonth,
                })}
              </p>
            )}
            {standing.kind === "comp" && <p className="mt-3 max-w-[62ch] text-body text-ink-2">{t("subscription.comp")}</p>}

            <div className="mt-6 flex flex-wrap items-start gap-3">
              {offersProCheckout(standing, openSubscription) && (confirming || <CheckoutButton item="pro_monthly" label={t("actions.getPro", { price: price("pro_monthly") })} className={WRAPS} />)}
              {hasBillingAccount && <ManageSubscriptionButton />}
              {!pro && (
                <Link href="/pricing" className={cn(textLinkClass, "px-2")}>
                  {t("actions.compare")}
                </Link>
              )}
            </div>
            {hasBillingAccount && <p className="mt-6 max-w-[62ch] text-body text-ink-2">{t("portalNote")}</p>}
          </AccountSection>

          <AccountSection n="02" id="billing-packs" title={t("packs.title")}>
            {credits && (
              <dl data-credits>
                <UsageRow label={t("credits.label")} figure={<Figure value={credits.balance} />}>
                  <RowNote>
                    {credits.note === "none"
                      ? t("credits.none", { size: INTERVIEW_PACK_CREDITS })
                      : credits.note === "pro"
                        ? t("credits.pro")
                        : t("credits.free", { minutes: FULL_MINUTES })}
                  </RowNote>
                  {credits.pending > 0 && <RowNote>{t("credits.pending", { count: credits.pending })}</RowNote>}
                </UsageRow>
              </dl>
            )}
            {pro ? (
              <div className={cn(credits && "mt-6")}>
                {confirming || (
                  <CheckoutButton
                    item="interview_pack"
                    label={t("actions.buyPack", { count: INTERVIEW_PACK_CREDITS, price: price("interview_pack") })}
                    variant="outline"
                    className={WRAPS}
                  />
                )}
              </div>
            ) : (
              <p className={cn("max-w-[62ch] text-body text-ink-2", credits && "mt-6")}>{t("packs.proOnly", { count: INTERVIEW_PACK_CREDITS })}</p>
            )}
          </AccountSection>
        </div>
      </div>
    </div>
  );
}
