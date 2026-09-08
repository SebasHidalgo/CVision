"use client";

import CountUp from "@/components/motion/CountUp";
import { cn } from "@/lib/utils";
import {
  clampScore,
  scoreTone,
  TONE_CLASS,
  TONE_LABEL,
  type ScoreTone,
} from "@/lib/score";

type ScoreReadoutProps = {
  score: number;
  size?: "md" | "lg" | "xl";
  /** Wording per tone; defaults to the generic set. */
  labels?: Record<ScoreTone, string>;
  className?: string;
};

const FIGURE = {
  md: "text-5xl",
  lg: "text-7xl md:text-8xl",
  xl: "text-[clamp(5.5rem,4rem+7vw,10rem)]",
};

/** The big number, counted up, with its tone word beside it. */
export default function ScoreReadout({
  score,
  size = "lg",
  labels = TONE_LABEL,
  className,
}: ScoreReadoutProps) {
  const value = clampScore(score);
  const tone = scoreTone(value);

  return (
    <div className={cn("flex items-end gap-3 md:gap-4", className)}>
      <span className={cn("figure text-ink", FIGURE[size])}>
        <CountUp value={value} />
      </span>
      <span className="mb-[0.1em] flex flex-col gap-1 pb-1">
        <span className="eyebrow">/ 100</span>
        <span className={cn("text-sm font-medium md:text-base", TONE_CLASS[tone].text)}>
          {labels[tone]}
        </span>
      </span>
    </div>
  );
}
