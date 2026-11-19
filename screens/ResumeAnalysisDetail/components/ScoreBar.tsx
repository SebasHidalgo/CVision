import { clampScore, SCORE_THRESHOLDS } from "@/lib/score";
import { cn } from "@/lib/utils";

type ScoreBarProps = {
  score: number;
  /** The meter's accessible name; without one the bar is decorative (the number is written beside it). */
  label?: string;
  className?: string;
};

/**
 * A 0-100 reading as the landing draws it: an ink fill on a hairline track, with ticks where "fair" (50) and
 * "strong" (70) start. Ink, not signal: a score is a reading of the CV, not proof of a requirement.
 */
export function ScoreBar({ score, label, className }: ScoreBarProps) {
  const value = clampScore(score);
  const meter = label
    ? ({ role: "meter", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": value } as const)
    : ({ "aria-hidden": true } as const);
  return (
    <span {...meter} className={cn("relative block h-[3px] bg-line-2", className)}>
      <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${value}%` }} />
      <i className="absolute -top-[3px] h-[9px] w-px bg-ink-3" style={{ left: `${SCORE_THRESHOLDS.fair}%` }} />
      <i className="absolute -top-[3px] h-[9px] w-px bg-ink-3" style={{ left: `${SCORE_THRESHOLDS.strong}%` }} />
    </span>
  );
}
