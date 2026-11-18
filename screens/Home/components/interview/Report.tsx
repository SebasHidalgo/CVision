"use client";

import { memo, useId } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { formatLongDate, ordinal } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { scoreTone, toneKey } from "@/lib/score";
import { cn } from "@/lib/utils";
import { EXAMPLE_REPORT } from "./exampleReport";
import { ReportDetails } from "./ReportDetails";
import { CAP, DISPLAY_MD, Meter, ROW, ROWS, TICK } from "./ui";
import type { Script } from "./useTalkScript";

const R = EXAMPLE_REPORT;
const QUOTE = "mt-3 max-w-[62ch] font-ed-text text-[15px] leading-[1.6] not-italic text-ed-ink";
const BODY = "mt-2.5 max-w-[62ch] text-[15px] leading-[1.6] text-ed-ink-2";

const OUTCOME_MARK = {
  addressed: "before:bg-ed-ink",
  partially: "before:bg-[linear-gradient(to_top,var(--color-ed-ink)_50%,transparent_50%)]",
} as const;

/**
 * The app's interview feedback page (screens/InterviewFeedback/components/FeedbackReport.tsx and TranscriptSection.tsx)
 * for the example conversation. Static: memoized so the excerpt's clock doesn't re-render it.
 */
export const Report = memo(function Report({
  script,
  role,
  requirements,
  quoteOf,
  locale,
}: {
  script: Script;
  role: string;
  requirements: readonly LocalizedRequirement[];
  /** The candidate's words of a talk line, as the report quotes them. */
  quoteOf: (line: number) => string;
  locale: Locale;
}) {
  const { t } = useTranslation("landingInterview");
  const { t: tc } = useTranslation("common");
  const eyebrowId = useId();
  const gapsId = useId();
  const answersId = useId();
  const stats = [
    t("app.feedback.stats.answers", { count: R.stats.answers }),
    t("app.feedback.stats.wordsEach", { count: R.stats.wordsEach }),
    t("app.feedback.stats.onFloor", { count: R.stats.onFloorMinutes }),
  ].join(" · ");
  const overall = t("app.feedback.report.overall");

  return (
    <article aria-labelledby={eyebrowId} className="px-[clamp(14px,2.4vw,28px)] pb-6">
      <header className="grid grid-cols-1 items-end gap-x-6 gap-y-[18px] border-b border-ed-line py-[22px] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div>
          <p id={eyebrowId} className={cn(CAP, TICK, "text-ed-ink-2")}>
            {t("app.feedback.header.eyebrow", { date: formatLongDate(R.date, locale) })}
          </p>
          <p className="mt-3.5 text-[16px] text-ed-ink-2">{t("app.feedback.header.kicker")}</p>
          <h3 className="mt-1 font-ed-display text-[clamp(28px,3vw,40px)] font-normal leading-[1.05] tracking-[-0.025em] text-ed-ink">{role}</h3>
          <p className="mt-3 text-ed-cap font-medium tracking-[0.02em] text-ed-ink-2">{stats}</p>
        </div>
        <div className="flex items-end gap-3 justify-self-start lg:justify-self-end">
          <span className="font-ed-display text-[clamp(64px,6vw,92px)] font-light leading-[0.9] tracking-[-0.03em] tabular-nums text-ed-ink">{R.total}</span>
          <span className="flex flex-col gap-1 pb-1.5">
            <span className={cn(CAP, "text-ed-ink-2")}>{tc("score.outOf")}</span>
            <span className="text-[15px] font-medium text-ed-ink">{tc(toneKey("performance", scoreTone(R.total)))}</span>
          </span>
        </div>
        <div className="col-span-full grid gap-2">
          <span aria-hidden className={cn(CAP, "text-ed-ink-2")}>
            {overall}
          </span>
          <Meter value={R.total} label={overall} size="lg" />
        </div>
        {/* The app's way back to the list; a picture of it here. */}
        <p className="col-span-full mt-1 inline-flex items-center gap-2 text-[14px] text-ed-ink-2">
          <ArrowLeft aria-hidden className="size-[18px]" />
          {t("app.feedback.actions.allInterviews")}
        </p>
      </header>

      <section aria-labelledby={gapsId} className="border-b border-ed-line py-6">
        <p className={cn(CAP, TICK, "text-ed-ink-2")}>{t("app.feedback.report.gaps.eyebrow")}</p>
        <h4 id={gapsId} className={cn(DISPLAY_MD, "mt-2.5")}>
          {t("app.feedback.report.gaps.title")}
        </h4>
        <ol className={ROWS}>
          {R.gaps.map((g, i) => {
            const req = requirements.find((r) => r.id === g.req);
            return (
              <li key={g.req} className={ROW}>
                <span className={cn(CAP, "pt-1 text-ed-ink")}>{ordinal(i)}</span>
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1.5">
                    <h5 className="text-[16.5px] font-medium leading-[1.35] text-ed-ink">{req ? `${req.n} · ${req.text}` : g.req}</h5>
                    <span
                      className={cn(
                        CAP,
                        "inline-flex items-center gap-[7px] text-ed-ink before:size-[9px] before:border before:border-ed-ink before:content-['']",
                        OUTCOME_MARK[g.outcome],
                      )}
                    >
                      {t(`app.feedback.report.outcome.${g.outcome}`)}
                    </span>
                  </div>
                  <blockquote className={cn(QUOTE, "border-l border-ed-line-2 pl-3.5")}>“{quoteOf(g.line)}”</blockquote>
                  <p className={BODY}>{t(`example.gaps.${g.req}`)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby={answersId} className="border-b border-ed-line py-6">
        <p className={cn(CAP, TICK, "text-ed-ink-2")}>{t("app.feedback.report.answers.eyebrow")}</p>
        <h4 id={answersId} className={cn(DISPLAY_MD, "mt-2.5")}>
          {t("app.feedback.report.answers.title")}
        </h4>
        <ul className="mt-[18px] grid grid-cols-1 gap-[22px] lg:grid-cols-2">
          {R.answers.map((a) => (
            <li key={a.id} className="border-t border-ed-line pt-3.5">
              <span className={cn(CAP, a.worked ? "text-ed-ink" : "text-ed-ink-2")}>
                {a.worked ? t("app.feedback.report.answers.worked") : t("app.feedback.report.answers.didntLand")}
              </span>
              <blockquote className={QUOTE}>“{quoteOf(a.line)}”</blockquote>
              <p className={BODY}>{t(`example.answers.${a.id}`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <ReportDetails script={script} quoteOf={quoteOf} />
    </article>
  );
});
