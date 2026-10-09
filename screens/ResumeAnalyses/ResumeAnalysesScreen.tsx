import EmptyState from "@/components/layout/EmptyState";
import IndexRow from "@/components/layout/IndexRow";
import PageIntro from "@/components/layout/PageIntro";
import { fetchAllResumes } from "@/lib/database/resume";
import { formatDate, ordinal } from "@/lib/format";
import { describeTally, deriveFitVerdict } from "@/lib/schemas/resumeSchema";
import { FIT_LABEL, TONE_CLASS } from "@/lib/score";

export default async function ResumeAnalysesScreen() {
  const analyses = await fetchAllResumes();

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
        eyebrow="Your analyses"
        title="Every CV you have measured."
        aside={
          analyses.length > 0 && (
            <dl className="flex gap-10 md:gap-14">
              <div>
                <dt className="eyebrow">Analyses</dt>
                <dd className="figure mt-3 text-5xl text-ink">
                  {analyses.length}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Strong fits</dt>
                <dd className="figure mt-3 flex items-baseline gap-1.5 text-5xl text-ink">
                  {strongCount}
                  <span className="eyebrow">/{analyses.length}</span>
                </dd>
              </div>
            </dl>
          )
        }
      />

      {analyses.length === 0 ? (
        <EmptyState
          title="Nothing measured yet."
          body="Paste a job post, upload your CV, and this page becomes the record of how each application stacks up."
          action={{ href: "/resume/upload", label: "Start your first analysis" }}
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
                meta={formatDate(analysis.createdAt)}
                reading={
                  verdict ? (
                    <div className="sm:text-right">
                      <p
                        className={`text-lg font-medium ${TONE_CLASS[verdict.tone].text}`}
                      >
                        {FIT_LABEL[verdict.tone]}
                      </p>
                      <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-3">
                        {describeTally(verdict.tally)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-signal">
                      We couldn&apos;t read this analysis. Run it again.
                    </p>
                  )
                }
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}
