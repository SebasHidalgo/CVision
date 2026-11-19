import { fontText } from "@/components/design-system/fonts";
import { Surface } from "@/components/design-system/Surface";
import ClientMessages from "@/components/i18n/ClientMessages";
import { fetchVisibleResumes } from "@/lib/database/resume";
import { currentInterviewEntitlement } from "@/lib/database/usage";
import { formatDate, ordinal } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { PLANS } from "@/lib/plans";
import { deriveFitVerdict } from "@/lib/schemas/resumeSchema";
import { cn } from "@/lib/utils";
import { AnalysisRow } from "./components/AnalysisRow";
import { EmptyRecord } from "./components/EmptyRecord";
import { HiddenAnalyses, type HiddenItem } from "./components/HiddenAnalyses";
import { PageHeading } from "@/components/design-system/PageHeading";
import { anyWaiting } from "./utils/attemptSummary";

const HEADING_ID = "analyses-title";
const HISTORY_LIMIT = PLANS.FREE.historyLimit ?? 0;

export default async function ResumeAnalysesScreen() {
  // Within the plan's history: Free sees its last three, Pro everything; the hidden ones come apart, to delete.
  const [{ analyses, hiddenAnalyses }, t, common, locale] = await Promise.all([fetchVisibleResumes(), getT("analyses"), getT("common"), getLocale()]);
  // A waiting rehearsal reads as its room does: only then is the entitlement worth reading.
  const entitlement = anyWaiting(analyses.map((analysis) => analysis.interviews)) ? await currentInterviewEntitlement() : null;

  // Fit is a verdict, not a number: the count of strong fits is the honest summary. Unreadable rows have none.
  const strongCount = analyses.filter((analysis) => analysis.feedback && deriveFitVerdict(analysis.feedback).tone === "strong").length;
  // Numbered after the visible ones: the same history, folded away.
  const hiddenItems: HiddenItem[] = hiddenAnalyses.map((analysis, i) => ({
    id: analysis.id,
    n: ordinal(analyses.length + i),
    jobTitle: analysis.jobTitle,
    companyName: analysis.companyName,
    date: formatDate(analysis.createdAt, locale),
    dateTime: analysis.createdAt,
    interviews: analysis.interviews,
  }));

  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div className="wrap pt-[clamp(40px,6vw,88px)] pb-section">
        <PageHeading
          id={HEADING_ID}
          ruled
          title={t("page.title")}
          aside={
            analyses.length > 0 && (
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <div className="flex items-baseline gap-2.5">
                  <dt className="text-small text-ink-2">{t("page.count")}</dt>
                  <dd className="mono text-[17px] text-ink">{analyses.length}</dd>
                </div>
                <div className="flex items-baseline gap-2.5">
                  <dt className="text-small text-ink-2">{t("page.strongFits")}</dt>
                  <dd className="mono text-[17px] text-ink">
                    {strongCount}
                    <span className="text-ink-2">/{analyses.length}</span>
                  </dd>
                </div>
              </dl>
            )
          }
        />

        <ClientMessages ns={["analyses"]}>
          {analyses.length === 0 ? (
            hiddenItems.length === 0 && (
              <EmptyRecord title={t("empty.title")} body={t("empty.body")} action={{ href: "/resume/upload", label: t("empty.action") }} />
            )
          ) : (
            <Surface as="ol" aria-label={t("page.listLabel")} className="mt-10 divide-y divide-line overflow-hidden">
              {analyses.map((analysis, i) => (
                <AnalysisRow
                  key={analysis.id}
                  analysis={analysis}
                  n={ordinal(i)}
                  locale={locale}
                  t={t}
                  common={common}
                  entitlement={entitlement}
                  headingId={HEADING_ID}
                />
              ))}
            </Surface>
          )}
          <HiddenAnalyses items={hiddenItems} limit={HISTORY_LIMIT} />
        </ClientMessages>
      </div>
    </div>
  );
}
