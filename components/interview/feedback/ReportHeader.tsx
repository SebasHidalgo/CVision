import type { TFunction } from "i18next";
import { ArrowLeft } from "lucide-react";
import { textLinkClass } from "@/components/design-system/Button";
import type { InterviewStats } from "@/lib/ai/schemas";
import { clampScore, scoreTone, toneKey } from "@/lib/score";
import { cn } from "@/lib/utils";
import { describeStats, plannedMinutes } from "./report";
import { EYEBROW, Heading, InkMark, MaybeLink, type HeadingLevel } from "./parts";

export type ReportHeaderProps = {
  role: string;
  /** Formatted by the caller, in the reader's language. */
  date: string;
  company: string | null;
  attempt: number | null;
  totalScore: number;
  stats: InterviewStats;
  /** Null in the landing's replica: the words without the link. */
  allInterviewsHref: string | null;
  level: HeadingLevel;
  embedded: boolean;
  titleId: string;
  t: TFunction<"feedback">;
  common: TFunction<"common">;
};

/** A meter from 0 to 100 in ink; it fills once when it first renders, and simply is there under reduced motion. */
export function ScoreBar({ value, label, size = "sm" }: { value: number; label: string; size?: "sm" | "lg" }) {
  const score = clampScore(value);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      className={cn("block overflow-hidden rounded-[2px] bg-ed-line-2", size === "lg" ? "h-1.5" : "h-1")}
    >
      <span
        className="block h-full origin-left scale-x-100 bg-ed-ink transition-[scale] duration-[900ms] ease-ed-out starting:scale-x-0 motion-reduce:transition-none"
        style={{ width: `${score}%` }}
      />
    </span>
  );
}

/** The report's head: what was rehearsed, when, the stats of the call, and the overall score with its word. */
export function ReportHeader({ role, date, company, attempt, totalScore, stats, allInterviewsHref, level, embedded, titleId, t, common }: ReportHeaderProps) {
  const score = clampScore(totalScore);
  const overall = t("report.overall");
  const meta = [company, attempt !== null ? t("header.attempt", { number: attempt }) : null].filter(Boolean).join(" · ");

  return (
    <header data-feedback-part="header" className={cn("ed-grid gap-y-7 border-b border-ed-line-2 lg:items-end", embedded ? "py-6" : "pb-[clamp(32px,4.5vw,56px)]")}>
      <div className="lg:col-[1/span_8]">
        <p className={EYEBROW}>{t("header.eyebrow", { date })}</p>
        <p className={cn("text-ed-lede text-ed-ink-2", embedded ? "mt-4" : "mt-6")}>{t("header.kicker")}</p>
        <Heading
          level={level}
          id={titleId}
          className={cn(
            "ed-display mt-1 text-balance break-words text-ed-ink",
            embedded ? "text-[clamp(30px,3.2vw,44px)] leading-[1.04] tracking-[-0.025em]" : "text-ed-h2",
          )}
        >
          {role}
        </Heading>
        {meta && <p className="mt-3 text-ed-body text-ed-ink-2">{meta}</p>}
        <p className="ed-mono mt-4 text-ed-small text-ed-ink-2">{describeStats(stats, t)}</p>
      </div>

      <p className="flex items-end gap-3.5 lg:col-[9/span_4] lg:justify-self-end">
        <span
          className={cn(
            "font-ed-display leading-[0.82] font-light tracking-[-0.04em] tabular-nums text-ed-ink",
            embedded ? "text-[clamp(64px,6vw,92px)]" : "text-[clamp(76px,8.4vw,128px)]",
          )}
        >
          {score}
        </span>
        <span className="grid gap-1 pb-1.5">
          <span className="ed-cap">{common("score.outOf")}</span>
          <span className="text-[17px] leading-tight font-medium text-ed-ink">{common(toneKey("performance", scoreTone(score)))}</span>
        </span>
      </p>

      <div className="grid gap-2.5">
        <span aria-hidden className="ed-cap">
          {overall}
        </span>
        <ScoreBar value={score} label={overall} size="lg" />
      </div>

      {stats.short && (
        <p role="note" data-feedback-short className="flex max-w-[68ch] items-start gap-3 text-ed-body text-ed-ink">
          <InkMark shape="dashed" className="mt-[0.4em]" />
          {t("report.short", { minutes: plannedMinutes(stats) })}
        </p>
      )}

      <div>
        <MaybeLink href={allInterviewsHref} className={cn(textLinkClass, "gap-2", allInterviewsHref === null && "hover:text-ed-ink-2 hover:no-underline cursor-default")}>
          <ArrowLeft aria-hidden className="size-4" />
          {t("actions.allInterviews")}
        </MaybeLink>
      </div>
    </header>
  );
}
