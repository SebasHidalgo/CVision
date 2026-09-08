import Link from "next/link";
import { ArrowLeft, Check, Video } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import ScoreMeter from "@/components/score/ScoreMeter";
import ScoreReadout from "@/components/score/ScoreReadout";
import { Button } from "@/components/ui/button";
import { ordinal } from "@/lib/format";
import { PERFORMANCE_LABEL, scoreTone, TONE_CLASS, TONE_LABEL } from "@/lib/score";
import { cn } from "@/lib/utils";
import type { InterviewFeedback } from "@/types/interview";

type FeedbackReportProps = {
  feedback: InterviewFeedback;
  /** Already formatted on the server. */
  date: string;
};

export default function FeedbackReport({ feedback, date }: FeedbackReportProps) {
  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <Eyebrow tick>Interview feedback · {date}</Eyebrow>
            <p className="mt-6 text-lg text-ink-2">Mock interview</p>
            <h1 className="display-lg mt-1 text-ink">{feedback.role}</h1>
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

      <div className="grid gap-12 py-10 lg:grid-cols-12 lg:gap-16 lg:py-14">
        <section aria-labelledby="readings-title" className="lg:col-span-7">
          <Reveal>
            <Eyebrow tick>Five readings</Eyebrow>
            <h2 id="readings-title" className="display-md mt-4 text-ink">
              Where the interview held up, and where it didn&apos;t.
            </h2>
          </Reveal>

          <ol className="mt-8 divide-y divide-line border-y border-line">
            {feedback.categoryScores.map((category, i) => {
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
          {feedback.strengths.length > 0 && (
            <Reveal>
              <h2 className="eyebrow">What worked</h2>
              <ul className="mt-4 space-y-3.5">
                {feedback.strengths.map((strength, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink">
                    <Check aria-hidden className="mt-1 size-4 shrink-0 text-strong" />
                    <span>{strength}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          )}

          {feedback.areasForImprovement.length > 0 && (
            <Reveal delay={0.08}>
              <h2 className="eyebrow">Work on this</h2>
              <ul className="mt-4 space-y-3.5">
                {feedback.areasForImprovement.map((area, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink">
                    <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 bg-signal" />
                    <span>{area}</span>
                  </li>
                ))}
              </ul>
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
            {feedback.finalAssessment}
          </blockquote>
        </section>
      </Reveal>
    </article>
  );
}
