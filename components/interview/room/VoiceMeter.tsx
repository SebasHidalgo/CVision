"use client";

import { useEffect, useRef } from "react";
import { CAP } from "@/components/interview/ui";
import { cn } from "@/lib/utils";
import { meterValue } from "./levels";
import type { Turn } from "./turn";
import { useReducedMotion } from "@/hooks/useMediaQuery";

/** Live voice levels (0 to 1), read on every frame; a room without a call passes none and the meters rest. */
export type MeterLevels = { interviewer: () => number; candidate: () => number };

const BARS = 32;
/** A new sample enters on the right this often: the history scrolls at a calm pace. */
const SAMPLE_MS = 70;
const REST = 0.07;
/** What a channel that holds the floor shows under reduced motion: a still shape, no movement. */
const STILL = Array.from({ length: BARS }, (_, i) => 0.22 + 0.5 * Math.abs(Math.sin(i * 0.61)) * (0.55 + 0.45 * Math.sin(i * 0.23)));

type Floor = "has" | "held" | null;

/**
 * The speaking indicator: one channel per voice, each a strip of level bars in ink, fed by the real output and input
 * levels. The channel that holds the turn is in full ink with a filled square; an interviewer holding it in silence
 * has an outlined one. Decorative: the room says who holds the turn in words.
 */
export function VoiceMeter({
  turn,
  levels,
  labels,
  compact = false,
  className,
}: {
  /** Null outside a call. */
  turn: Turn | null;
  levels?: MeterLevels | null;
  labels: { interviewer: string; candidate: string };
  /** Shorter bars on a phone in a call, where every line of the transcript counts. */
  compact?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div data-room-part="meter" aria-hidden className={cn("grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-1 lg:gap-y-5", className)}>
      <Channel who="interviewer" label={labels.interviewer} floor={turn === "interviewer" ? "has" : turn === "waiting" ? "held" : null} level={levels?.interviewer} still={reduce} compact={compact} />
      <Channel who="candidate" label={labels.candidate} floor={turn === "candidate" ? "has" : null} level={levels?.candidate} still={reduce} compact={compact} />
    </div>
  );
}

function Channel({ who, label, floor, level, still, compact }: { who: "interviewer" | "candidate"; label: string; floor: Floor; level?: () => number; still: boolean; compact: boolean }) {
  const strip = useRef<HTMLDivElement>(null);
  // The latest reader, so a new function each render never restarts the history.
  const read = useRef(level);
  useEffect(() => {
    read.current = level;
  });
  const moving = !!level && !still;
  const shaped = still && floor === "has";

  useEffect(() => {
    const box = strip.current;
    if (!box) return;
    const bars = Array.from(box.children) as HTMLElement[];
    const draw = (values: readonly number[]) => {
      bars.forEach((bar, i) => {
        const next = `scaleY(${Math.max(REST, values[i] ?? 0).toFixed(3)})`;
        if (bar.style.transform !== next) bar.style.transform = next;
      });
    };
    if (!moving || typeof requestAnimationFrame !== "function") {
      draw(shaped ? STILL : []);
      return;
    }
    const history: number[] = Array(BARS).fill(0);
    let sampled = -Infinity;
    let frame = requestAnimationFrame(function tick(time) {
      if (time - sampled >= SAMPLE_MS) {
        sampled = time;
        let value = 0;
        try {
          value = meterValue(read.current?.() ?? 0);
        } catch {
          value = 0;
        }
        history.shift();
        history.push(value);
        draw(history);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      draw([]);
    };
  }, [moving, shaped]);

  return (
    <div data-meter={who} data-floor={floor ?? "none"} className={cn("min-w-0", floor ? "text-ed-ink" : "text-ed-ink-3")}>
      <p className={cn(CAP, "flex items-start gap-2 text-current")}>
        <span className={cn("mt-1 size-[7px] flex-none border border-current", floor === "has" ? "bg-current" : floor === null && "border-transparent")} />
        <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      </p>
      <div ref={strip} className={cn("flex items-center justify-between gap-px sm:mt-2.5 sm:h-9 lg:h-11", compact ? "mt-2 h-6" : "mt-2.5 h-9")}>
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            className="block h-full w-[3px] flex-none origin-center rounded-full bg-current transition-transform duration-75 ease-linear motion-reduce:transition-none"
            style={{ transform: `scaleY(${REST})` }}
          />
        ))}
      </div>
    </div>
  );
}
