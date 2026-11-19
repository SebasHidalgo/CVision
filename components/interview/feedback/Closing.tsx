import type { TFunction } from "i18next";
import { ArrowRight, RotateCcw } from "lucide-react";
import { buttonClass } from "@/components/design-system/Button";
import { Surface } from "@/components/design-system/Surface";
import { TranscriptLines } from "@/components/interview/TranscriptLines";
import { cn } from "@/lib/utils";
import type { ReportTranscript } from "./transcript";
import { EYEBROW, Heading, MaybeLink, ReportSection, type HeadingLevel, type ProseRenderer } from "./parts";

/** The final assessment: the model's closing paragraph, set large. Its words, not a quote: a paragraph, not a blockquote. */
export function FinalAssessment({
  text,
  id,
  level,
  embedded,
  prose,
  t,
}: {
  text: string;
  id: string;
  level: HeadingLevel;
  embedded: boolean;
  prose: ProseRenderer;
  t: TFunction<"feedback">;
}) {
  return (
    <ReportSection part="final" id={id} eyebrow={t("report.finalAssessment")} level={level} embedded={embedded}>
      <p className="max-w-[42ch] font-ed-display text-[clamp(22px,2.2vw,30px)] leading-[1.28] font-normal tracking-[-0.012em] text-ed-ink">
        {prose(text, 3)}
      </p>
    </ReportSection>
  );
}

/** Where the next rehearsal starts, and what the plan has left for it. */
export type RehearseNext = {
  /** The analysis page, where the interview control lives; null in the landing's replica. */
  href: string | null;
  /** "again" while the plan can start one; "analysis" when it can't (the analysis page says what to buy). */
  action: "again" | "analysis";
  /** "3 of 4 interviews left this period", formatted by the caller from the entitlement. */
  note: string | null;
};

export function RehearseAgain({ next, id, level, t }: { next: RehearseNext; id: string; level: HeadingLevel; t: TFunction<"feedback"> }) {
  return (
    <Surface as="section" aria-labelledby={id} data-feedback-part="next" className="mt-[clamp(40px,5.5vw,72px)] px-[clamp(20px,3.4vw,40px)] py-[clamp(28px,4vw,44px)]">
      <p className={EYEBROW}>{t("next.eyebrow")}</p>
      <div className="mt-4 max-w-[60ch]">
        <Heading level={level} id={id} className="ed-display text-[clamp(28px,3vw,40px)] leading-[1.06] tracking-[-0.025em] text-balance text-ed-ink">
          {t("next.title")}
        </Heading>
        <p className="mt-4 text-ed-lede text-ed-ink-2">{t("next.lede")}</p>
      </div>
      <div className="mt-8 flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        <MaybeLink
          href={next.href}
          className={cn(buttonClass(), next.href === null && "cursor-default hover:translate-y-0 active:scale-100")}
        >
          {next.action === "again" ? (
            <>
              <RotateCcw aria-hidden className="size-4 flex-none" />
              {t("next.action")}
            </>
          ) : (
            <>
              {t("next.actionAnalysis")}
              <ArrowRight aria-hidden className="size-4 flex-none" />
            </>
          )}
        </MaybeLink>
        {next.note && <p className="min-w-0 text-[15px] text-ed-ink-2">{next.note}</p>}
      </div>
    </Surface>
  );
}

/** The whole call under the report, folded: the report quotes from it, and any quote can be checked against it. */
export function TranscriptFold({
  transcript,
  note,
  t,
}: {
  transcript: ReportTranscript;
  /** Above the lines: the landing's "a sample" note. */
  note?: React.ReactNode;
  t: TFunction<"feedback">;
}) {
  return (
    <details data-feedback-part="transcript" className="group mt-[clamp(40px,5.5vw,72px)] border-t border-ed-line-2">
      <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 [&::-webkit-details-marker]:hidden">
        <span className={EYEBROW}>{t("transcript.title")}</span>
        <span className="ed-cap tabular-nums text-ed-ink">
          {t("transcript.lines", { count: transcript.lines })} · <span className="group-open:hidden">{t("transcript.show")}</span>
          <span className="hidden group-open:inline">{t("transcript.hide")}</span>
        </span>
      </summary>
      <div className="ed-grid pt-4 pb-2">
        <div className="min-w-0 lg:col-[5/span_8]">
          {note && <p className="mb-5 text-ed-small text-ed-ink-2">{note}</p>}
          <TranscriptLines
            entries={transcript.entries}
            labels={{ interviewer: t("transcript.interviewer"), candidate: t("transcript.you"), resumed: t("transcript.resumed") }}
          />
        </div>
      </div>
    </details>
  );
}
