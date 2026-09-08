"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export type VoiceOrbState =
  | "idle"
  | "connecting"
  | "speaking"
  | "listening"
  | "ended";

type VoiceOrbProps = {
  state: VoiceOrbState;
  className?: string;
};

const RINGS = [0, 1, 2];

/**
 * The interviewer's presence: a disc in the surface's ink with rings that
 * travel outward while it speaks and rest while it listens.
 */
export default function VoiceOrb({ state, className }: VoiceOrbProps) {
  const reduce = useReducedMotion();
  const speaking = state === "speaking" && !reduce;
  const listening = state === "listening" && !reduce;

  return (
    <div aria-hidden className={cn("relative aspect-square", className)}>
      {RINGS.map((i) => (
        <motion.span
          key={`${state}-${i}`}
          className="absolute inset-0 rounded-full border border-ink"
          initial={{ scale: 0.72 + i * 0.12, opacity: 0 }}
          animate={
            speaking
              ? { scale: [0.72, 1.2], opacity: [0.55, 0] }
              : {
                  scale: 0.72 + i * 0.12,
                  opacity:
                    state === "ended" ? 0 : listening ? 0.32 - i * 0.09 : 0.18 - i * 0.05,
                }
          }
          transition={
            speaking
              ? {
                  duration: 1.7,
                  ease: "easeOut",
                  repeat: Infinity,
                  delay: i * 0.5,
                }
              : { duration: 0.9, ease: [0.16, 1, 0.3, 1] }
          }
        />
      ))}

      <motion.span
        className="absolute inset-[30%] rounded-full bg-ink"
        animate={
          state === "ended"
            ? { scale: 0.6, opacity: 0.25 }
            : speaking
              ? { scale: [1, 1.08, 0.98, 1.05, 1], opacity: 1 }
              : listening
                ? { scale: [1, 1.03, 1], opacity: 1 }
                : { scale: 1, opacity: 1 }
        }
        transition={
          speaking
            ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
            : listening
              ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.8, ease: [0.16, 1, 0.3, 1] }
        }
      />

      {state === "connecting" && (
        <span className="absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal animate-blink" />
      )}
    </div>
  );
}
