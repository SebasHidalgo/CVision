import { AccountSection, Cells, Figure, RowNote, UsageRow } from "@/components/account/AccountSection";
import { AccountTabs } from "@/components/account/AccountTabs";
import { Mark } from "@/components/account/Mark";
import { standingCopy } from "@/components/account/standingCopy";
import { ButtonLink } from "@/components/design-system/Button";
import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { Surface } from "@/components/design-system/Surface";
import ClientMessages from "@/components/i18n/ClientMessages";
import LocaleMenu from "@/components/i18n/LocaleMenu";
import { offersProCheckout } from "@/lib/accountStanding";
import { currentOpenSubscriptionStatus, currentUsageSummary } from "@/lib/database/usage";
import { formatLongDate } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { INTERVIEW_PACK_CREDITS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import DeleteAccount from "./components/DeleteAccount";
import SignInPanel from "./components/SignInPanel";
import { accountView, PRO_FACTS } from "./utils/accountView";

const REMOVED = ["analyses", "interviews", "voice", "billing", "signIn"] as const;
const KEPT = ["paddle", "log"] as const;

/**
 * The account: the plan and its standing, this period's analyses and interviews (the trial instead for Free, the
 * credits where they mean something), the interface language, Clerk's sign-in settings, and deleting the account.
 * Paying, the portal and the packs are on Plan & billing.
 */
export default async function AccountScreen() {
  const [summary, openSubscription, t, common, locale] = await Promise.all([currentUsageSummary(), currentOpenSubscriptionStatus(), getT("account"), getT("common"), getLocale()]);
  const view = accountView(summary);
  const standing = standingCopy(view.standing, t, locale);
  const subscribed = view.standing.kind === "active" || view.standing.kind === "past-due" || view.standing.kind === "cancels";
  const periodDate = formatLongDate(view.period.date, locale);

  return (
    <div className={cn("ed-root flex-1", fontText.variable)}>
      <div className="ed-wrap pt-[clamp(40px,6vw,88px)] pb-ed-section">
        <PageHeading title={t("meta.accountTitle")} />
        <AccountTabs current="account" t={t} />

        <ClientMessages ns={["account"]}>
          <div className="mt-[clamp(8px,2vw,16px)]">
            <AccountSection n="01" id="account-plan" title={t("overview.plan.title")}>
              <div data-standing={view.standing.kind} className="flex flex-wrap items-end gap-x-6 gap-y-3">
                <p className="ed-display text-[clamp(64px,9vw,112px)] leading-[0.82] text-ed-ink">{common(`plan.${summary.plan}`)}</p>
                <p className="flex items-center gap-2.5 pb-1.5 text-ed-small font-medium text-ed-ink">
                  <Mark shape={standing.shape} />
                  {standing.label}
                </p>
              </div>
              <p className="mt-5 max-w-[62ch] text-ed-body text-ed-ink-2">{standing.line}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {/* Pro is sold only where a checkout can succeed: not while a paused subscription is open. */}
                {offersProCheckout(view.standing, openSubscription) && (
                  <ButtonLink href="/pricing" size="sm">
                    {t("overview.plan.seePro")}
                  </ButtonLink>
                )}
                <ButtonLink href="/account/billing" variant="ghost" size="sm">
                  {t("overview.plan.billing")}
                </ButtonLink>
              </div>
            </AccountSection>

            <AccountSection
              n="02"
              id="account-usage"
              title={t("overview.usage.title")}
              note={view.period.kind === "pro-ends" ? t("overview.usage.proEnds", { date: periodDate }) : t("overview.usage.resets", { date: periodDate })}
            >
              <dl data-usage>
                <UsageRow
                  label={t("analyses.label")}
                  figure={
                    view.analyses.kind === "count" ? (
                      <>
                        <Cells total={view.analyses.limit} left={view.analyses.left} />
                        <Figure value={view.analyses.left} of={t("analyses.left", { limit: view.analyses.limit })} />
                      </>
                    ) : (
                      <span className="text-ed-body font-medium text-ed-ink">{t("analyses.upTo", { limit: view.analyses.limit })}</span>
                    )
                  }
                >
                  {view.analyses.kind === "up-to" && view.analyses.reached && <RowNote>{t("analyses.reached", { limit: view.analyses.limit })}</RowNote>}
                </UsageRow>

                {view.interviews.kind === "period" ? (
                  <UsageRow
                    label={t("interviews.label")}
                    figure={
                      <>
                        <Cells total={view.interviews.limit} left={view.interviews.left} />
                        <Figure value={view.interviews.left} of={t("interviews.left", { limit: view.interviews.limit })} />
                      </>
                    }
                  >
                    <RowNote>{t("interviews.length", { minutes: view.interviews.minutes })}</RowNote>
                  </UsageRow>
                ) : (
                  <UsageRow
                    label={t("trial.label")}
                    figure={
                      <span className="flex items-center gap-2.5 text-ed-body font-medium text-ed-ink">
                        <Mark shape={view.interviews.state === "available" ? "filled" : view.interviews.state === "used" ? "empty" : "dashed"} />
                        {t(`trial.${view.interviews.state}`)}
                      </span>
                    }
                  >
                    <RowNote>
                      {view.interviews.note === "available"
                        ? t("trial.availableNote", { minutes: view.interviews.minutes })
                        : view.interviews.note === "credits-cover"
                          ? t("interviews.creditsCover", { perMonth: PRO_FACTS.interviewsPerMonth })
                          : view.interviews.note === "pro-only"
                            ? t("interviews.proOnly")
                            : t("trial.unavailableNote")}
                    </RowNote>
                  </UsageRow>
                )}

                {view.credits && (
                  <UsageRow label={t("credits.label")} figure={<Figure value={view.credits.balance} />}>
                    <RowNote>
                      {view.credits.note === "none"
                        ? t("credits.none", { size: INTERVIEW_PACK_CREDITS })
                        : view.credits.note === "pro"
                          ? t("credits.pro")
                          : t("credits.free", { minutes: PRO_FACTS.minutes })}
                    </RowNote>
                    {view.credits.pending > 0 && <RowNote>{t("credits.pending", { count: view.credits.pending })}</RowNote>}
                  </UsageRow>
                )}
              </dl>
            </AccountSection>

            <AccountSection n="03" id="account-language" title={common("locale.accountTitle")}>
              <div className="grid gap-5">
                <p className="max-w-[62ch] text-ed-body text-ed-ink-2">{common("locale.accountBody")}</p>
                <div>
                  <LocaleMenu />
                </div>
              </div>
            </AccountSection>

            <AccountSection n="04" id="account-sign-in" title={t("overview.signIn.title")}>
              <SignInPanel />
            </AccountSection>

            <AccountSection n="05" id="account-delete" title={t("overview.delete.title")}>
              <p className="max-w-[62ch] text-ed-body text-ed-ink">{t("overview.delete.lede")}</p>
              <Surface className="mt-6 grid gap-x-10 gap-y-6 p-6 max-sm:p-5 md:grid-cols-2">
                <div>
                  <h3 className="ed-cap">{t("overview.delete.removedTitle")}</h3>
                  <ul className="mt-3 grid gap-2.5">
                    {REMOVED.map((item) => (
                      <li key={item} className="flex gap-3 text-ed-body text-ed-ink">
                        <span aria-hidden className="mt-[0.6em] h-px w-3 flex-none bg-ed-ink-2" />
                        {t(`overview.delete.removed.${item}`)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="ed-cap">{t("overview.delete.keptTitle")}</h3>
                  <ul className="mt-3 grid gap-2.5">
                    {KEPT.map((item) => (
                      <li key={item} className="flex gap-3 text-ed-body text-ed-ink-2">
                        <span aria-hidden className="mt-[0.6em] h-px w-3 flex-none bg-ed-ink-3" />
                        {t(`overview.delete.kept.${item}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              </Surface>
              <div className="mt-6">
                <DeleteAccount subscribed={subscribed} />
              </div>
            </AccountSection>
          </div>
        </ClientMessages>
      </div>
    </div>
  );
}
