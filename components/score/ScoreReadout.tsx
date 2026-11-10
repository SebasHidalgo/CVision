"use client";

import { useTranslation } from "react-i18next";
import CountUp from "@/components/motion/CountUp";
import { cn } from "@/lib/utils";
import {
  clampScore,
  scoreTone,
  TONE_CLASS,
  toneKey,
  type ToneWording,
} from "@/lib/score";

type ScoreReadoutProps = {
  score: number;
  size?: "md" | "lg" | "xl";
  /** Which words the tone reads in; defaults to the generic set. */
  wording?: ToneWording;
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
  wording = "tone",
  className,
}: ScoreReadoutProps) {
  const value = clampScore(score);
  const tone = scoreTone(value);
  const { t } = useTranslation("common");

  return (
    <div className={cn("flex items-end gap-3 md:gap-4", className)}>
      <span className={cn("figure text-ink", FIGURE[size])}>
        <CountUp value={value} />
      </span>
      <span className="mb-[0.1em] flex flex-col gap-1 pb-1">
        <span className="eyebrow">{t("score.outOf")}</span>
        <span className={cn("text-sm font-medium md:text-base", TONE_CLASS[tone].text)}>
          {t(toneKey(wording, tone))}
        </span>
      </span>
    </div>
  );
}
