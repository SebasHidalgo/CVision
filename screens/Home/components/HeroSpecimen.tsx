"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, X } from "lucide-react";
import CountUp from "@/components/motion/CountUp";
import ScoreMeter from "@/components/score/ScoreMeter";
import { cn } from "@/lib/utils";

const SAMPLE_SCORE = 74;

const SKILLS = [
  { name: "TypeScript", matched: true },
  { name: "React", matched: true },
  { name: "GraphQL", matched: false },
  { name: "Testing", matched: true },
  { name: "Accessibility", matched: false },
];

const EASE = [0.16, 1, 0.3, 1] as const;

/** A text line on the sheet: width in percent. */
function Line({ w, className }: { w: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block h-[5px] rounded-none bg-paper-3", className)}
      style={{ width: `${w}%` }}
    />
  );
}

/**
 * A sample analysis assembled from the real parts: a sheet, the pencil marks
 * and the meter. Illustration, not a screenshot, so it stays on-system.
 */
export function HeroSpecimen() {
  const reduce = useReducedMotion();

  const item = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: EASE, delay },
  });

  return (
    <motion.figure
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: EASE, delay: 0.2 }}
      className="relative mx-auto w-full max-w-[420px]"
    >
      <figcaption className="eyebrow mb-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <span>Sample analysis</span>
        <span className="text-ink">Frontend Engineer · Northwind</span>
      </figcaption>

      <div className="relative bg-sheet p-6 shadow-sheet sm:p-8">
        {/* Header of the CV */}
        <motion.div {...item(0.5)}>
          <span className="block h-3 w-2/5 bg-ink" />
          <Line w={55} className="mt-3" />
          <Line w={40} className="mt-2" />
        </motion.div>

        {/* Experience with one pencil note */}
        <motion.div {...item(0.7)} className="mt-8">
          <p className="eyebrow">Experience</p>
          <Line w={92} className="mt-3" />
          <Line w={84} className="mt-2" />
          <div className="relative mt-2">
            <Line w={70} />
            <motion.span
              aria-hidden
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, ease: EASE, delay: 1.5 }}
              className="absolute top-[9px] left-0 h-[2px] w-[70%] origin-left bg-signal"
            />
            <motion.span
              {...item(1.9)}
              className="absolute top-[-4px] left-[73%] font-mono text-[10.5px] whitespace-nowrap text-signal"
            >
              ← add a number
            </motion.span>
          </div>
          <Line w={88} className="mt-4" />
        </motion.div>

        {/* Skills: matched and missing */}
        <motion.div {...item(0.9)} className="mt-8">
          <p className="eyebrow">Skills vs. posting</p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {SKILLS.map((skill, i) => (
              <motion.li
                key={skill.name}
                {...item(1.1 + i * 0.12)}
                className={cn(
                  "inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px]",
                  skill.matched
                    ? "border-strong/40 text-ink"
                    : "border-signal/50 text-signal line-through decoration-signal",
                )}
              >
                {skill.matched ? (
                  <Check className="size-3 text-strong" />
                ) : (
                  <X className="size-3" />
                )}
                {skill.name}
              </motion.li>
            ))}
          </ul>
        </motion.div>

        {/* The verdict */}
        <motion.div {...item(1.4)} className="mt-9 border-t border-line pt-6">
          <div className="flex items-end justify-between">
            <p className="eyebrow">Fit</p>
            <p className="flex items-baseline gap-2">
              <span className="figure text-5xl text-ink">
                <CountUp value={SAMPLE_SCORE} delay={1.7} />
              </span>
              <span className="text-sm font-medium text-strong">Strong fit</span>
            </p>
          </div>
          <ScoreMeter
            score={SAMPLE_SCORE}
            size="md"
            reveal="mount"
            delay={1.7}
            label="Sample fit score"
            className="mt-3"
          />
        </motion.div>

        {/* Sheet corner */}
        <span
          aria-hidden
          className="absolute top-0 right-0 size-5 bg-paper-2 [clip-path:polygon(0_0,100%_100%,0_100%)]"
        />
      </div>
    </motion.figure>
  );
}
