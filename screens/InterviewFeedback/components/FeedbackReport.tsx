import Link from "next/link";
import type { TFunction } from "i18next";
import { ArrowLeft, Check } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import ScoreMeter from "@/components/score/ScoreMeter";
import ScoreReadout from "@/components/score/ScoreReadout";
import type {
  AnchoredPoint,
  FEEDBACK_CATEGORIES,
  GapOutcome,
  InterviewFeedbackReport,
  InterviewStats,
} from "@/lib/ai/schemas";
import type { TranscriptTurn } from "@/lib/elevenlabs/postCall";
import { ordinal } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { scoreTone, TONE_CLASS, toneKey } from "@/lib/score";
import { cn } from "@/lib/utils";
import type { InterviewFeedback } from "@/types/interview";
import TranscriptSection from "./TranscriptSection";

type FeedbackReportProps = {
  feedback: InterviewFeedback;
  /** The stored turns the report quotes from; null when the row has none. */
  transcript: TranscriptTurn[] | null;
  /** Already formatted on the server. */
  date: string;
};

const OUTCOME = {
  addressed: { key: "report.outcome.addressed", className: TONE_CLASS.strong.text },
  partially: { key: "report.outcome.partially", className: TONE_CLASS.fair.text },
  dodged: { key: "report.outcome.dodged", className: TONE_CLASS.weak.text },
  not_raised: { key: "report.outcome.notRaised", className: "text-ink-3" },
} as const satisfies Record<GapOutcome, { key: string; className: string }>;

/** The stored category is an enum value; the heading is its label in the interface language. */
const CATEGORY_KEY = {
  "Communication Skills": "categories.communicationSkills",
  "Technical Knowledge": "categories.technicalKnowledge",
  "Problem Solving": "categories.problemSolving",
  "Cultural Fit": "categories.culturalFit",
  "Confidence and Clarity": "categories.confidenceAndClarity",
} as const satisfies Record<(typeof FEEDBACK_CATEGORIES)[number], string>;

/**
 * "6 answers · 54 words each · about 5 min on the floor", from the measured
 * stats. "On the floor" is from each answer's start to the interviewer's
 * next turn, so it includes the pause before the reply.
 */
function describeStats(stats: InterviewStats, t: TFunction<"feedback">): string {
  const parts = [
    t("stats.answers", { count: stats.candidateTurns }),
    t("stats.wordsEach", { count: Math.round(stats.averageCandidateTurnWords) }),
  ];
  if (stats.candidateOnFloorSeconds !== null) {
    parts.push(t("stats.onFloor", { count: Math.max(1, Math.round(stats.candidateOnFloorSeconds / 60)) }));
  }
  if (stats.short) parts.push(t("stats.short"));
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
                  “{anchor}”
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default async function FeedbackReport({ feedback, transcript, date }: FeedbackReportProps) {
  const [t, common] = await Promise.all([getT("feedback"), getT("common")]);
  const { report } = feedback;
  // The guardrail empties a quote it could not find in the transcript; a "why" without its answer is hidden.
  const answers = report.notableAnswers.filter((answer) => answer.quote.trim());

  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <Eyebrow tick>{t("header.eyebrow", { date })}</Eyebrow>
            <p className="mt-6 text-lg text-ink-2">{t("header.kicker")}</p>
            <h1 className="display-lg mt-1 text-ink">{feedback.role}</h1>
            <p className="eyebrow mt-5">{describeStats(report.interviewStats, t)}</p>
          </div>
          <div className="lg:col-span-5 lg:justify-self-end">
            <ScoreReadout
              score={feedback.totalScore}
              size="xl"
              wording="performance"
            />
          </div>
        </div>

        <ScoreMeter
          score={feedback.totalScore}
          size="lg"
          label={t("report.overall")}
          reveal="mount"
          delay={0.2}
          className="mt-8"
        />

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/interviews" className="link-rule inline-flex items-center gap-2 px-2 text-sm text-ink-2">
            <ArrowLeft className="size-4" />
            {t("actions.allInterviews")}
          </Link>
        </div>
      </header>

      {/* The lead: what happened to the gaps the analysis found. */}
      <section aria-labelledby="gaps-title" className="border-b border-line py-10 lg:py-14">
        <Reveal>
          <Eyebrow tick>{t("report.gaps.eyebrow")}</Eyebrow>
          <h2 id="gaps-title" className="display-md mt-4 text-ink">
            {report.gapFollowThrough.length === 0 ? t("report.gaps.none") : t("report.gaps.title")}
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
                          {t(outcome.key)}
                        </span>
                      </div>
                      {row.quote && (
                        <blockquote className="mt-4 max-w-2xl border-l border-line-strong pl-4 text-[15px] leading-relaxed text-ink">
                          “{row.quote}”
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

      {answers.length > 0 && (
        <section aria-labelledby="answers-title" className="border-b border-line py-10 lg:py-14">
          <Reveal>
            <Eyebrow tick>{t("report.answers.eyebrow")}</Eyebrow>
            <h2 id="answers-title" className="display-md mt-4 text-ink">
              {t("report.answers.title")}
            </h2>
          </Reveal>
          <ul className="mt-8 grid gap-8 md:grid-cols-2">
            {answers.map((answer, i) => (
              <Reveal key={i} delay={i * 0.06}>
                <li className="flex h-full flex-col border-t border-line pt-5">
                  <span
                    className={cn(
                      "eyebrow",
                      answer.worked ? TONE_CLASS.strong.text : TONE_CLASS.weak.text,
                    )}
                  >
                    {answer.worked ? t("report.answers.worked") : t("report.answers.didntLand")}
                  </span>
                  <blockquote className="mt-3 text-[15px] leading-relaxed text-ink">
                    “{answer.quote}”
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
            <Eyebrow tick>{t("report.readings.eyebrow")}</Eyebrow>
            <h2 id="readings-title" className="display-md mt-4 text-ink">
              {t("report.readings.title")}
            </h2>
          </Reveal>

          <ol className="mt-8 divide-y divide-line border-y border-line">
            {report.categoryScores.map((category, i) => {
              const tone = scoreTone(category.score);
              const name = t(CATEGORY_KEY[category.name]);
              return (
                <Reveal key={category.name} delay={i * 0.06}>
                  <li className="grid gap-5 py-7 sm:grid-cols-[3rem_1fr] sm:gap-6">
                    <span className="eyebrow pt-1.5 text-ink">{ordinal(i)}</span>
                    <div>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
                        <h3 className="display-sm text-ink">{name}</h3>
                        <div className="flex w-full items-center gap-3 sm:w-56 sm:shrink-0">
                          <span className="figure w-12 text-4xl text-ink tabular">
                            {category.score}
                          </span>
                          <div className="min-w-0 flex-1">
                            <ScoreMeter
                              score={category.score}
                              size="sm"
                              label={common("score.scoreOf", { label: name })}
                            />
                            <p className={cn("mt-1.5 text-xs font-medium", TONE_CLASS[tone].text)}>
                              {common(toneKey("tone", tone))}
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
              <h2 className="eyebrow">{t("report.strengths")}</h2>
              <PointList
                report={report}
                items={report.strengths}
                marker={<Check aria-hidden className="mt-1 size-4 shrink-0 text-strong" />}
              />
            </Reveal>
          )}

          {report.areasForImprovement.length > 0 && (
            <Reveal delay={0.08}>
              <h2 className="eyebrow">{t("report.improve")}</h2>
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
            <span id="assessment-title">{t("report.finalAssessment")}</span>
          </Eyebrow>
          <blockquote className="display-md mt-6 max-w-4xl text-ink">
            {report.finalAssessment}
          </blockquote>
        </section>
      </Reveal>

      {transcript && <TranscriptSection turns={transcript} t={t} />}
    </article>
  );
}
