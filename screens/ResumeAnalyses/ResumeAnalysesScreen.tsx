import { HistoryLine } from "@/components/billing/HistoryNotice";
import EmptyState from "@/components/layout/EmptyState";
import IndexRow from "@/components/layout/IndexRow";
import PageIntro from "@/components/layout/PageIntro";
import { fetchVisibleResumes } from "@/lib/database/resume";
import { formatDate, ordinal } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { tallyCopy } from "@/lib/i18n/tally";
import { deriveFitVerdict } from "@/lib/schemas/resumeSchema";
import { TONE_CLASS, toneKey } from "@/lib/score";

export default async function ResumeAnalysesScreen() {
  // Within the plan's history: Free sees its last three, Pro everything.
  const [{ analyses, hidden }, t, common, locale] = await Promise.all([fetchVisibleResumes(), getT("analysis"), getT("common"), getLocale()]);

  // Rows whose stored feedback no longer matches the schema come back with
  // null feedback and have no verdict to derive.
  const verdicts = analyses.map((analysis) =>
    analysis.feedback ? deriveFitVerdict(analysis.feedback) : null,
  );
  // There is no average to take any more: fit is a verdict, not a number. The
  // count of strong fits is the honest summary of the same thing.
  const strongCount = verdicts.filter((verdict) => verdict?.tone === "strong").length;

  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro
        eyebrow={t("list.eyebrow")}
        title={t("list.title")}
        aside={
          analyses.length > 0 && (
            <dl className="flex gap-10 md:gap-14">
              <div>
                <dt className="eyebrow">{t("list.count")}</dt>
                <dd className="figure mt-3 text-5xl text-ink">
                  {analyses.length}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">{t("list.strongFits")}</dt>
                <dd className="figure mt-3 flex items-baseline gap-1.5 text-5xl text-ink">
                  {strongCount}
                  <span className="eyebrow">/{analyses.length}</span>
                </dd>
              </div>
            </dl>
          )
        }
      />

      {analyses.length === 0 && hidden === 0 ? (
        <EmptyState
          title={t("list.emptyTitle")}
          body={t("list.emptyBody")}
          action={{ href: "/resume/upload", label: t("list.emptyAction") }}
        />
      ) : (
        <ol className="divide-y divide-line border-b border-line">
          {analyses.map((analysis, i) => {
            const verdict = verdicts[i];

            return (
              <IndexRow
                key={analysis.id}
                index={ordinal(i)}
                href={verdict ? `/resume/analysis/${analysis.id}` : undefined}
                title={analysis.companyName}
                subtitle={analysis.jobTitle}
                meta={formatDate(analysis.createdAt, locale)}
                reading={
                  verdict ? (
                    <div className="sm:text-right">
                      <p
                        className={`text-lg font-medium ${TONE_CLASS[verdict.tone].text}`}
                      >
                        {common(toneKey("fit", verdict.tone))}
                      </p>
                      <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-3">
                        {tallyCopy(common, verdict.tally)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-signal">{t("list.unreadable")}</p>
                  )
                }
              />
            );
          })}
        </ol>
      )}
      <HistoryLine hidden={hidden} what="analyses" />
    </div>
  );
}
