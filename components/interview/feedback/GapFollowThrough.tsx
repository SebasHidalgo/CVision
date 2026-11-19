import type { TFunction } from "i18next";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import { ordinal } from "@/lib/format";
import { OUTCOME_KEY } from "./report";
import { Heading, InkMark, OUTCOME_SHAPE, ReportSection, SpokenQuote, sub, type HeadingLevel, type ProseRenderer } from "./parts";

/** The report's lead: each gap the analysis found, what happened to it in the room, in the candidate's words. */
export function GapFollowThrough({
  rows,
  id,
  level,
  embedded,
  prose,
  t,
}: {
  rows: InterviewFeedbackReport["gapFollowThrough"];
  id: string;
  level: HeadingLevel;
  embedded: boolean;
  prose: ProseRenderer;
  t: TFunction<"feedback">;
}) {
  return (
    <ReportSection
      part="gaps"
      id={id}
      eyebrow={t("report.gaps.eyebrow")}
      title={rows.length === 0 ? t("report.gaps.none") : t("report.gaps.title")}
      level={level}
      embedded={embedded}
    >
      {rows.length > 0 && (
        <ol className="border-t border-line">
          {rows.map((row, i) => (
            <li key={i} data-feedback-row="gap" data-outcome={row.outcome} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 border-b border-line py-6 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:gap-x-4">
              <span aria-hidden className="mono pt-[3px] text-[13px] text-ink-2">
                {ordinal(i)}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <Heading level={sub(level)} className="max-w-[60ch] text-[17px] leading-[1.4] font-medium break-words text-ink">
                    {row.requirement}
                  </Heading>
                  <p className="cap inline-flex shrink-0 items-center gap-2 text-ink">
                    <InkMark shape={OUTCOME_SHAPE[row.outcome]} />
                    {t(OUTCOME_KEY[row.outcome])}
                  </p>
                </div>
                {row.quote.trim() && <SpokenQuote text={row.quote} className="mt-4 max-w-[68ch]" />}
                <p className="mt-3 max-w-[68ch] text-body text-ink-2">
                  {prose(row.note, 1)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </ReportSection>
  );
}
