import type { TFunction } from "i18next";
import { Check } from "lucide-react";
import type { AnchoredPoint, InterviewFeedbackReport } from "@/lib/ai/schemas";
import { ordinal } from "@/lib/format";
import { clampScore, scoreTone, toneKey } from "@/lib/score";
import { anchorOf, categoryKey, orderedCategories } from "./report";
import { EYEBROW, Heading, ReportSection, SpokenQuote, sub, type HeadingLevel, type ProseRenderer } from "./parts";
import { ScoreBar } from "./ReportHeader";

/** The five readings: each category's score, its word on the one scale (50 / 70), and the comment behind it. */
export function Readings({
  report,
  id,
  level,
  embedded,
  prose,
  t,
  common,
}: {
  report: InterviewFeedbackReport;
  id: string;
  level: HeadingLevel;
  embedded: boolean;
  prose: ProseRenderer;
  t: TFunction<"feedback">;
  common: TFunction<"common">;
}) {
  return (
    <ReportSection part="readings" id={id} eyebrow={t("report.readings.eyebrow")} title={t("report.readings.title")} level={level} embedded={embedded}>
      <ol className="border-t border-ed-line">
        {orderedCategories(report).map((category, i) => {
          const name = t(categoryKey(category.name));
          const score = clampScore(category.score);
          return (
            <li key={category.name} data-feedback-row="reading" className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 border-b border-ed-line py-6 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:gap-x-4">
              <span aria-hidden className="ed-mono pt-[5px] text-[13px] text-ed-ink-2">
                {ordinal(i)}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                  <Heading level={sub(level)} className="font-ed-display text-[21px] leading-[1.2] font-normal tracking-[-0.01em] text-ed-ink">
                    {name}
                  </Heading>
                  <div className="flex w-full items-center gap-3 sm:w-[14rem]">
                    <span className="w-[2.2ch] font-ed-display text-[32px] leading-[0.9] font-light tracking-[-0.03em] tabular-nums text-ed-ink">{score}</span>
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <ScoreBar value={score} label={common("score.scoreOf", { label: name })} />
                      <span className="text-ed-small font-medium text-ed-ink">{common(toneKey("tone", scoreTone(score)))}</span>
                    </div>
                  </div>
                </div>
                <p className="mt-3 max-w-[68ch] text-ed-body text-ed-ink-2">
                  {prose(category.comment)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </ReportSection>
  );
}

function PointList({
  report,
  points,
  kind,
  prose,
  t,
}: {
  report: InterviewFeedbackReport;
  points: AnchoredPoint[];
  kind: "worked" | "workOn";
  prose: ProseRenderer;
  t: TFunction<"feedback">;
}) {
  return (
    <ul className="mt-4 grid gap-6">
      {points.map((point, i) => {
        const anchor = anchorOf(report, point);
        return (
          <li key={i} data-feedback-row={kind} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            {kind === "worked" ? (
              <Check aria-hidden className="mt-[3px] size-4 text-ed-ink" />
            ) : (
              <span aria-hidden className="mt-[0.55em] size-1.5 justify-self-center bg-ed-ink" />
            )}
            <div className="min-w-0">
              <p className="max-w-[68ch] text-ed-body text-ed-ink">
                {prose(point.point, 1)}
              </p>
              {anchor?.kind === "quote" && <SpokenQuote text={anchor.text} size="small" className="mt-2.5" />}
              {anchor?.kind === "gap" && <p className="mt-2 text-ed-small text-ed-ink-2">{t("report.onGap", { requirement: anchor.text })}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "What worked" and "Work on this": each point with the words it rests on. A list with nothing in it is left out. */
export function Points({
  report,
  id,
  level,
  embedded,
  prose,
  t,
}: {
  report: InterviewFeedbackReport;
  id: string;
  level: HeadingLevel;
  embedded: boolean;
  prose: ProseRenderer;
  t: TFunction<"feedback">;
}) {
  const lists = [
    { kind: "worked" as const, title: t("report.strengths"), points: report.strengths },
    { kind: "workOn" as const, title: t("report.improve"), points: report.areasForImprovement },
  ].filter((list) => list.points.length > 0);
  if (lists.length === 0) return null;

  return (
    <ReportSection part="points" id={id} eyebrow={t("report.points.eyebrow")} title={t("report.points.title")} level={level} embedded={embedded}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-10 xl:grid-cols-2">
        {lists.map((list) => (
          <div key={list.kind} className="min-w-0 border-t border-ed-line pt-4">
            <Heading level={sub(level)} className={EYEBROW}>
              {list.title}
            </Heading>
            <PointList report={report} points={list.points} kind={list.kind} prose={prose} t={t} />
          </div>
        ))}
      </div>
    </ReportSection>
  );
}
