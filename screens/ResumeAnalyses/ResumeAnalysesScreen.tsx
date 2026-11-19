import { fontText } from "@/components/design-system/fonts";
import { Surface } from "@/components/design-system/Surface";
import ClientMessages from "@/components/i18n/ClientMessages";
import { fetchResumes } from "@/lib/database/resume";
import { currentInterviewEntitlement } from "@/lib/database/usage";
import { ordinal } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { deriveFitVerdict } from "@/lib/schemas/resumeSchema";
import { cn } from "@/lib/utils";
import { AnalysisRow } from "./components/AnalysisRow";
import { EmptyRecord } from "./components/EmptyRecord";
import { PageHeading } from "@/components/design-system/PageHeading";
import { anyWaiting } from "./utils/attemptSummary";

const HEADING_ID = "analyses-title";

export default async function ResumeAnalysesScreen() {
  // Every analysis the caller owns, on every plan.
  const [analyses, t, common, locale] = await Promise.all([fetchResumes(), getT("analyses"), getT("common"), getLocale()]);
  // A waiting rehearsal reads as its room does: only then is the entitlement worth reading.
  const entitlement = anyWaiting(analyses.map((analysis) => analysis.interviews)) ? await currentInterviewEntitlement() : null;

  // Fit is a verdict, not a number: the count of strong fits is the honest summary. Unreadable rows have none.
  const strongCount = analyses.filter((analysis) => analysis.feedback && deriveFitVerdict(analysis.feedback).tone === "strong").length;

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
            <EmptyRecord title={t("empty.title")} body={t("empty.body")} action={{ href: "/resume/upload", label: t("empty.action") }} />
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
        </ClientMessages>
      </div>
    </div>
  );
}
