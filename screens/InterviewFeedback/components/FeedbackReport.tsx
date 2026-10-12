import Link from "next/link";
import { ArrowLeft, Check, Video } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import ScoreMeter from "@/components/score/ScoreMeter";
import ScoreReadout from "@/components/score/ScoreReadout";
import { Button } from "@/components/ui/button";
import type {
  AnchoredPoint,
  GapOutcome,
  InterviewFeedbackReport,
  InterviewStats,
} from "@/lib/ai/schemas";
import { ordinal } from "@/lib/format";
import { PERFORMANCE_LABEL, scoreTone, TONE_CLASS, TONE_LABEL } from "@/lib/score";
import { cn } from "@/lib/utils";
import type { InterviewFeedback } from "@/types/interview";

type FeedbackReportProps = {
  feedback: InterviewFeedback;
  /** Already formatted on the server. */
  date: string;
};

const OUTCOME: Record<GapOutcome, { label: string; className: string }> = {
  addressed: { label: "Addressed", className: TONE_CLASS.strong.text },
  partially: { label: "Partly addressed", className: TONE_CLASS.fair.text },
  dodged: { label: "Dodged", className: TONE_CLASS.weak.text },
  not_raised: { label: "Not raised", className: "text-ink-3" },
};

/** "6 answers · 54 words each · about 5 min speaking", from the measured stats. */
function describeStats(stats: InterviewStats): string {
  const parts = [
    `${stats.candidateTurns} ${stats.candidateTurns === 1 ? "answer" : "answers"}`,
    `${Math.round(stats.averageCandidateTurnWords)} words each`,
  ];
  if (stats.candidateFloorSeconds !== null) {
    parts.push(`about ${Math.max(1, Math.round(stats.candidateFloorSeconds / 60))} min speaking`);
  }
  if (stats.short) parts.push("short interview, low-confidence scores");
  return parts.join(" · ");
}

/** The candidate's words a point rests on, or the gap it refers to. */
function anchorText(report: InterviewFeedbackReport, point: AnchoredPoint): string | null {
  const { source, index } = point.anchor;
  if (source === "notableAnswers") return report.notableAnswers[index]?.quote ?? null;
  const row = report.gapFollowThrough[index];
  if (!row) return null;
  return row.quote || row.requirement;
}

function PointList({
  report,
  items,
  marker,
}: {
  report: InterviewFeedbackReport;
  items: AnchoredPoint[];
  marker: React.ReactNode;
}) {
  return (
    <ul className="mt-4 space-y-5">
      {items.map((item, i) => {
        const anchor = anchorText(report, item);
        return (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink">
            {marker}
            <div className="min-w-0">
              <p>{item.point}</p>
              {anchor && (
                <p className="mt-1.5 border-l border-line pl-3 text-sm text-ink-2">
                  &ldquo;{anchor}&rdquo;
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function FeedbackReport({ feedback, date }: FeedbackReportProps) {
  const { report } = feedback;

  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <Eyebrow tick>Interview feedback · {date}</Eyebrow>
            <p className="mt-6 text-lg text-ink-2">Mock interview</p>
            <h1 className="display-lg mt-1 text-ink">{feedback.role}</h1>
            <p className="eyebrow mt-5">{describeStats(report.interviewStats)}</p>
          </div>
          <div className="lg:col-span-5 lg:justify-self-end">
            <ScoreReadout
              score={feedback.totalScore}
              size="xl"
              labels={PERFORMANCE_LABEL}
            />
          </div>
        </div>

        <ScoreMeter
          score={feedback.totalScore}
          size="lg"
          label="Overall performance"
          reveal="mount"
          delay={0.2}
          className="mt-8"
        />

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {feedback.recordingUrl && (
            <Button asChild variant="outline" className="h-11 gap-2 px-5">
              <a href={feedback.recordingUrl} target="_blank" rel="noopener noreferrer">
                <Video className="size-4" />
                Watch the recording
              </a>
            </Button>
          )}
          <Link href="/interviews" className="link-rule inline-flex items-center gap-2 px-2 text-sm text-ink-2">
            <ArrowLeft className="size-4" />
            All interviews
          </Link>
        </div>
      </header>

      {/* The lead: what happened to the gaps the analysis found. */}
      <section aria-labelledby="gaps-title" className="border-b border-line py-10 lg:py-14">
        <Reveal>
          <Eyebrow tick>Your weak spots, in the room</Eyebrow>
          <h2 id="gaps-title" className="display-md mt-4 text-ink">
            {report.gapFollowThrough.length === 0
              ? "The analysis found no gaps to probe."
              : "The analysis flagged these. Here is how each one went."}
          </h2>
        </Reveal>

        {report.gapFollowThrough.length > 0 && (
          <ol className="mt-8 divide-y divide-line border-y border-line">
            {report.gapFollowThrough.map((row, i) => {
              const outcome = OUTCOME[row.outcome];
              return (
                <Reveal key={i} delay={i * 0.06}>
                  <li className="grid gap-4 py-7 sm:grid-cols-[3rem_1fr] sm:gap-6">
                    <span className="eyebrow pt-1.5 text-ink">{ordinal(i)}</span>
                    <div className="min-w-0">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
                        <h3 className="text-[17px] font-medium leading-snug text-ink">
                          {row.requirement}
                        </h3>
                        <span className={cn("eyebrow shrink-0", outcome.className)}>
                          {outcome.label}
                        </span>
                      </div>
                      {row.quote && (
                        <blockquote className="mt-4 max-w-2xl border-l border-line-strong pl-4 text-[15px] leading-relaxed text-ink">
                          &ldquo;{row.quote}&rdquo;
                        </blockquote>
                      )}
                      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">
                        {row.note}
                      </p>
                    </div>
                  </li>
                </Reveal>
              );
            })}
          </ol>
        )}
      </section>

      {report.notableAnswers.length > 0 && (
        <section aria-labelledby="answers-title" className="border-b border-line py-10 lg:py-14">
          <Reveal>
            <Eyebrow tick>Answers worth hearing again</Eyebrow>
            <h2 id="answers-title" className="display-md mt-4 text-ink">
              In your own words.
            </h2>
          </Reveal>
          <ul className="mt-8 grid gap-8 md:grid-cols-2">
            {report.notableAnswers.map((answer, i) => (
              <Reveal key={i} delay={i * 0.06}>
                <li className="flex h-full flex-col border-t border-line pt-5">
                  <span
                    className={cn(
                      "eyebrow",
                      answer.worked ? TONE_CLASS.strong.text : TONE_CLASS.weak.text,
                    )}
                  >
                    {answer.worked ? "Worked" : "Didn't land"}
                  </span>
                  <blockquote className="mt-3 text-[15px] leading-relaxed text-ink">
                    &ldquo;{answer.quote}&rdquo;
                  </blockquote>
                  <p className="mt-3 text-sm leading-relaxed text-ink-2">{answer.why}</p>
                </li>
              </Reveal>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-12 py-10 lg:grid-cols-12 lg:gap-16 lg:py-14">
        <section aria-labelledby="readings-title" className="lg:col-span-7">
          <Reveal>
            <Eyebrow tick>Five readings</Eyebrow>
            <h2 id="readings-title" className="display-md mt-4 text-ink">
              Where the interview held up, and where it didn&apos;t.
            </h2>
          </Reveal>

          <ol className="mt-8 divide-y divide-line border-y border-line">
            {report.categoryScores.map((category, i) => {
              const tone = scoreTone(category.score);
              return (
                <Reveal key={category.name} delay={i * 0.06}>
                  <li className="grid gap-5 py-7 sm:grid-cols-[3rem_1fr] sm:gap-6">
                    <span className="eyebrow pt-1.5 text-ink">{ordinal(i)}</span>
                    <div>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
                        <h3 className="display-sm text-ink">{category.name}</h3>
                        <div className="flex w-full items-center gap-3 sm:w-56 sm:shrink-0">
                          <span className="figure w-12 text-4xl text-ink tabular">
                            {category.score}
                          </span>
                          <div className="min-w-0 flex-1">
                            <ScoreMeter
                              score={category.score}
                              size="sm"
                              label={`${category.name} score`}
                            />
                            <p className={cn("mt-1.5 text-xs font-medium", TONE_CLASS[tone].text)}>
                              {TONE_LABEL[tone]}
                            </p>
                          </div>
                        </div>
                      </div>
                      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-2">
                        {category.comment}
                      </p>
                    </div>
                  </li>
                </Reveal>
              );
            })}
          </ol>
        </section>

        <aside className="space-y-12 lg:col-span-5">
          {report.strengths.length > 0 && (
            <Reveal>
              <h2 className="eyebrow">What worked</h2>
              <PointList
                report={report}
                items={report.strengths}
                marker={<Check aria-hidden className="mt-1 size-4 shrink-0 text-strong" />}
              />
            </Reveal>
          )}

          {report.areasForImprovement.length > 0 && (
            <Reveal delay={0.08}>
              <h2 className="eyebrow">Work on this</h2>
              <PointList
                report={report}
                items={report.areasForImprovement}
                marker={<span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 bg-signal" />}
              />
            </Reveal>
          )}
        </aside>
      </div>

      <Reveal>
        <section
          aria-labelledby="assessment-title"
          className="border-t border-line py-12 lg:py-16"
        >
          <Eyebrow tick>
            <span id="assessment-title">Final assessment</span>
          </Eyebrow>
          <blockquote className="display-md mt-6 max-w-4xl text-ink">
            {report.finalAssessment}
          </blockquote>
        </section>
      </Reveal>
    </article>
  );
}
