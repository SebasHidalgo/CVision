"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { ordinal } from "@/lib/format";
import { scoreTone, toneKey } from "@/lib/score";
import { cn } from "@/lib/utils";
import { EXAMPLE_REPORT } from "./exampleReport";
import { TranscriptList } from "./TranscriptList";
import { CAP, DISPLAY_MD, Meter, ROW, ROWS, TICK } from "./ui";
import type { Script } from "./useTalkScript";

const R = EXAMPLE_REPORT;
const ANCHOR = "mt-1.5 border-l border-ed-line pl-3 text-[14px] text-ed-ink-2";

/** The report's second half: the five readings, what worked and what to work on, the final assessment, the transcript. */
export function ReportDetails({ script, quoteOf }: { script: Script; quoteOf: (line: number) => string }) {
  const { t } = useTranslation("landingInterview");
  const { t: tc } = useTranslation("common");
  const readingsId = useId();
  const finalId = useId();

  return (
    <>
      <div className="grid grid-cols-1 gap-8 border-b border-ed-line py-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section aria-labelledby={readingsId}>
          <p className={cn(CAP, TICK, "text-ed-ink-2")}>{t("app.feedback.report.readings.eyebrow")}</p>
          <h4 id={readingsId} className={cn(DISPLAY_MD, "mt-2.5")}>
            {t("app.feedback.report.readings.title")}
          </h4>
          <ol className={ROWS}>
            {R.categories.map((c, i) => {
              const name = t(`app.feedback.categories.${c.id}`);
              return (
                <li key={c.id} className={ROW}>
                  <span className={cn(CAP, "pt-1 text-ed-ink")}>{ordinal(i)}</span>
                  <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2.5">
                    <h5 className="font-ed-display text-[19px] font-normal leading-[1.2] text-ed-ink">{name}</h5>
                    <div className="flex w-full items-center gap-2.5 lg:w-[13rem]">
                      <span className="w-[2.1ch] font-ed-display text-[30px] font-light leading-[0.9] tracking-[-0.03em] tabular-nums text-ed-ink">{c.score}</span>
                      <div className="grid flex-1 gap-[5px]">
                        <Meter value={c.score} label={tc("score.scoreOf", { label: name })} />
                        <span className="text-[12.5px] font-medium text-ed-ink">{tc(toneKey("tone", scoreTone(c.score)))}</span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
        <aside className="grid content-start gap-7">
          <div>
            <h4 className={cn(CAP, "text-ed-ink-2")}>{t("app.feedback.report.strengths")}</h4>
            <ul className="mt-3.5 grid gap-[18px]">
              {R.worked.map((p) => (
                <li key={p.id} className="flex gap-2.5 text-[15px] leading-[1.55] text-ed-ink">
                  <Check aria-hidden className="mt-[3px] size-4 flex-none text-ed-ink" />
                  <div>
                    <p>{t(`example.worked.${p.id}`)}</p>
                    <p className={ANCHOR}>“{quoteOf(p.line)}”</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className={cn(CAP, "text-ed-ink-2")}>{t("app.feedback.report.improve")}</h4>
            <ul className="mt-3.5 grid gap-[18px]">
              {R.workOn.map((p) => (
                <li key={p.id} className="flex gap-2.5 text-[15px] leading-[1.55] text-ed-ink">
                  <span aria-hidden className="mt-[0.6em] size-1.5 flex-none bg-ed-ink" />
                  <div>
                    <p>{t(`example.workOn.${p.id}`)}</p>
                    <p className={ANCHOR}>“{quoteOf(p.line)}”</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <section aria-labelledby={finalId} className="border-b border-ed-line py-6">
        <p id={finalId} className={cn(CAP, TICK, "text-ed-ink-2")}>
          {t("app.feedback.report.finalAssessment")}
        </p>
        <blockquote className="mt-3 max-w-[44ch] font-ed-display text-[clamp(20px,1.9vw,25px)] font-normal leading-[1.15] tracking-[-0.015em] text-ed-ink">
          {t("example.final")}
        </blockquote>
      </section>

      <details className="group pt-5 pb-1.5">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
          <span className={cn(CAP, TICK, "text-ed-ink-2")}>{t("app.feedback.transcript.title")}</span>
          <span className={cn(CAP, "tabular-nums text-ed-ink-2")}>
            {t("app.feedback.transcript.lines", { count: R.transcriptLines })} ·{" "}
            <span className="group-open:hidden">{t("app.feedback.transcript.show")}</span>
            <span className="hidden group-open:inline">{t("app.feedback.transcript.hide")}</span>
          </span>
        </summary>
        <p className="mt-3.5 text-[13.5px] text-ed-ink-2">{t("example.sample", { total: R.transcriptLines })}</p>
        <TranscriptList
          lines={script.lines}
          labels={{ interviewer: t("app.feedback.transcript.interviewer"), you: t("app.feedback.transcript.you") }}
          timed
          className="mt-4"
        />
      </details>
    </>
  );
}
