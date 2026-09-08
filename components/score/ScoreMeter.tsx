"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { clampScore, scoreTone, TONE_CLASS, type ScoreTone } from "@/lib/score";

type ScoreMeterProps = {
  score: number;
  tone?: ScoreTone;
  size?: "sm" | "md" | "lg";
  /** Accessible name; the value is exposed through the meter role. */
  label?: string;
  /** "mount" for list rows, "inView" for long pages. */
  reveal?: "mount" | "inView";
  /** Seconds. */
  delay?: number;
  className?: string;
};

const TRACK = { sm: "h-2.5", md: "h-4", lg: "h-8" };
const BAR = { sm: "h-[3px]", md: "h-1", lg: "h-1.5" };
const VIEWPORT = { once: true, margin: "0px 0px -10% 0px" };

/**
 * The product's signature reading: a ruled track with a needle. The fill
 * carries the tone; the needle is always the signal red of an instrument.
 */
export default function ScoreMeter({
  score,
  tone,
  size = "md",
  label = "Score",
  reveal = "inView",
  delay = 0,
  className,
}: ScoreMeterProps) {
  const value = clampScore(score);
  const t = tone ?? scoreTone(value);
  const reduce = useReducedMotion();

  const transition = { duration: 1.1, ease: [0.16, 1, 0.3, 1] as const, delay };
  const fill = { width: `${value}%` };
  const needle = { left: `${value}%` };
  const onMount = reveal === "mount";

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn("relative w-full", className)}
    >
      <div
        className={cn("relative border-b border-line-strong", TRACK[size])}
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--line) 1px, transparent 1px)",
          backgroundSize: "10% 100%",
        }}
      >
        {/* Zone boundaries: fair from 50, strong from 70. */}
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        <span aria-hidden className="absolute inset-y-0 left-[70%] w-px bg-line-strong" />
        <span aria-hidden className="absolute inset-y-0 right-0 w-px bg-line-strong" />

        <motion.span
          aria-hidden
          initial={reduce ? fill : { width: "0%" }}
          animate={onMount ? fill : undefined}
          whileInView={onMount ? undefined : fill}
          viewport={onMount ? undefined : VIEWPORT}
          transition={transition}
          className={cn("absolute bottom-0 left-0", BAR[size], TONE_CLASS[t].bg)}
        />

        <motion.span
          aria-hidden
          initial={reduce ? needle : { left: "0%" }}
          animate={onMount ? needle : undefined}
          whileInView={onMount ? undefined : needle}
          viewport={onMount ? undefined : VIEWPORT}
          transition={transition}
          style={{ x: "-50%" }}
          className="absolute -top-1 -bottom-1 w-[1.5px] bg-signal"
        >
          <span className="absolute -top-px left-1/2 size-[5px] -translate-x-1/2 bg-signal" />
        </motion.span>
      </div>

      {size === "lg" && (
        <div aria-hidden className="eyebrow relative mt-2 h-4 select-none tabular">
          <span className="absolute left-0">0</span>
          <span className="absolute left-1/2 -translate-x-1/2">50</span>
          <span className="absolute left-[70%] -translate-x-1/2">70</span>
          <span className="absolute right-0">100</span>
        </div>
      )}
    </div>
  );
}
