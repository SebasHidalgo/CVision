"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Surface } from "@/components/design-system/Surface";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/screens/ResumeUpload/utils/format";
import { clock, runSteps, type RunClock, type RunPhase, type StepState } from "@/screens/ResumeUpload/utils/runSteps";
import CvSheet from "./CvSheet";

// The analysis usually answers in about 9 s (measured; its timeout chain allows far more): past this, say so.
const SLOW_AFTER_SECONDS = 20;

export type SentDetails = { companyName: string; jobTitle: string; fileName: string; fileSize: number };

type AnalysisInProgressProps = {
  phase: RunPhase;
  startedAt: RunClock;
  sent: SentDetails;
};

/** Done is filled, now is an outline with a beating core, next is a faint outline. Ink only: nothing here is proof. */
function StepMark({ state }: { state: StepState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative mt-[0.4em] inline-flex size-[11px] flex-none items-center justify-center border-[1.5px]",
        state === "done" && "border-ed-ink bg-ed-ink",
        state === "now" && "border-ed-ink",
        state === "next" && "border-ed-line-2",
      )}
    >
      {state === "now" && <span className="size-[3px] bg-ed-ink motion-safe:animate-pulse" />}
    </span>
  );
}

/**
 * The run as the browser sees it: the upload, the analysis request, the move to the saved analysis. Each step shows
 * the time it really took; nothing inside the analysis is shown as progress, because nothing inside it is observed.
 */
export default function AnalysisInProgress({ phase, startedAt, sent }: AnalysisInProgressProps) {
  const { t } = useTranslation("upload");
  const heading = useRef<HTMLHeadingElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // The submit that had focus is gone: the heading takes it, so a reader lands on what is happening.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const steps = runSteps(phase, startedAt, now);
  const analysis = steps.find((step) => step.phase === "analyzing");
  const slow = phase === "analyzing" && (analysis?.seconds ?? 0) >= SLOW_AFTER_SECONDS;

  return (
    <section aria-labelledby="run-title" className="ed-grid gap-y-10 border-t border-ed-line-2 pt-[clamp(28px,4vw,48px)]">
      <div className="lg:col-[5/span_8] lg:row-start-1 lg:max-w-[75ch]">
        <h2
          ref={heading}
          id="run-title"
          tabIndex={-1}
          className="ed-display text-[clamp(30px,3.4vw,44px)] leading-[1.08] tracking-[-0.02em] text-balance focus:outline-none"
        >
          {t(`run.title.${phase}`)}
        </h2>
        {/* The heading is read when it takes focus; later phases are announced here. */}
        <p role="status" className="sr-only">
          {phase === "uploading" ? "" : t(`run.title.${phase}`)}
        </p>

        <ol aria-label={t("run.steps.label")} className="mt-8 border-t border-ed-line">
          {steps.map((step) => (
            <li
              key={step.phase}
              aria-current={step.state === "now" ? "step" : undefined}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-ed-line py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
            >
              <StepMark state={step.state} />
              <div className="min-w-0">
                <p className={cn("text-ed-h3 font-semibold", step.state === "next" ? "text-ed-ink-2" : "text-ed-ink")}>
                  {t(`run.steps.${step.phase}.title`)}
                </p>
                <p className="mt-1 max-w-[58ch] text-ed-ink-2">
                  {t(`run.steps.${step.phase}.detail`, { size: formatFileSize(sent.fileSize, t) })}
                </p>
              </div>
              <p className="col-start-2 text-ed-small text-ed-ink-2 sm:col-start-3 sm:pt-0.5 sm:text-right">
                <span className={cn(step.state === "now" && "font-medium text-ed-ink")}>{t(`run.state.${step.state}`)}</span>
                {/* Ticks every second: kept from screen readers, which would read it on every visit. */}
                {step.seconds !== null && <span aria-hidden className="ed-mono text-[13px]">{` · ${clock(step.seconds)}`}</span>}
              </p>
            </li>
          ))}
        </ol>

        {phase === "analyzing" && (
          <div className="mt-8 grid gap-2 border-l border-ed-line-2 pl-5">
            <h3 className="ed-cap">{t("run.now.title")}</h3>
            <p className="max-w-[65ch] text-ed-ink-2">{t("run.now.body")}</p>
          </div>
        )}

        <div aria-live="polite">{slow && <p className="mt-6 text-ed-ink">{t("run.slow")}</p>}</div>
        <p className="mt-6 text-ed-small text-ed-ink-2">{t("run.keepOpen")}</p>
      </div>

      <div className="lg:col-[1/span_4] lg:row-start-1 lg:pr-ed-gutter">
        <h3 className="ed-cap">{t("run.sent")}</h3>
        <Surface className="mt-4 grid gap-4 p-5">
          <div className="flex min-w-0 items-center gap-4">
            <CvSheet />
            <div className="min-w-0">
              <p data-truncate="file-name" title={sent.fileName} className="truncate font-medium text-ed-ink">
                {sent.fileName}
              </p>
              <p className="ed-mono mt-1 text-[13px] text-ed-ink-3">{t("file.details", { size: formatFileSize(sent.fileSize, t) })}</p>
            </div>
          </div>
          <dl className="grid border-t border-ed-line text-[15px]">
            <div className="grid gap-0.5 border-b border-ed-line py-2.5">
              <dt className="text-ed-ink-3">{t("form.company")}</dt>
              <dd className="break-words text-ed-ink">{sent.companyName}</dd>
            </div>
            <div className="grid gap-0.5 border-b border-ed-line py-2.5">
              <dt className="text-ed-ink-3">{t("form.jobTitle")}</dt>
              <dd className="break-words text-ed-ink">{sent.jobTitle}</dd>
            </div>
          </dl>
        </Surface>
      </div>
    </section>
  );
}
