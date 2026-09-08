import EmptyState from "@/components/layout/EmptyState";
import IndexRow from "@/components/layout/IndexRow";
import PageIntro from "@/components/layout/PageIntro";
import ScoreMeter from "@/components/score/ScoreMeter";
import { fetchAllResumes } from "@/lib/database/resume";
import { formatDate, ordinal } from "@/lib/format";
import { FIT_LABEL, scoreTone, TONE_CLASS } from "@/lib/score";

export default async function ResumeAnalysesScreen() {
  const analyses = await fetchAllResumes();

  // Rows that no longer match the feedback schema come back with null
  // feedback; keeping them out stops one bad analysis from skewing the average.
  const scores = analyses
    .map((analysis) => analysis.feedback?.overall.globalScore)
    .filter((score): score is number => typeof score === "number");

  const averageScore = scores.length
    ? Math.round(scores.reduce((acc, score) => acc + score, 0) / scores.length)
    : null;

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
                <dt className="eyebrow">Average fit</dt>
                <dd className="figure mt-3 flex items-baseline gap-1.5 text-5xl text-ink">
                  {averageScore ?? "–"}
                  <span className="eyebrow">/100</span>
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
            const overall = analysis.feedback?.overall;
            const score = overall?.globalScore;
            const tone = typeof score === "number" ? scoreTone(score) : null;

            return (
              <IndexRow
                key={analysis.id}
                index={ordinal(i)}
                href={overall ? `/resume/analysis/${analysis.id}` : undefined}
                title={analysis.companyName}
                subtitle={analysis.jobTitle}
                meta={formatDate(analysis.createdAt)}
                reading={
                  typeof score === "number" && tone ? (
                    <div className="flex items-center gap-4">
                      <span className="figure w-10 shrink-0 text-3xl text-ink tabular">
                        {score}
                      </span>
                      <div className="min-w-0 flex-1">
                        <ScoreMeter
                          score={score}
                          size="sm"
                          reveal="mount"
                          delay={0.1 + i * 0.05}
                          label={`Fit score for ${analysis.jobTitle} at ${analysis.companyName}`}
                        />
                        <p className={`mt-1.5 text-xs font-medium ${TONE_CLASS[tone].text}`}>
                          {FIT_LABEL[tone]}
                        </p>
                      </div>
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
