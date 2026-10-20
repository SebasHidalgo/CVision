"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** One finished line of the call, in the roles the platform uses. */
export type TranscriptLine = {
  role: "agent" | "user";
  text: string;
};

type TranscriptProps = {
  lines: TranscriptLine[];
  live: boolean;
  className?: string;
};

/**
 * The conversation as a script, for the candidate's benefit during the call.
 * A convenience only: the transcript that is scored arrives by webhook, and
 * nothing shown here is ever sent anywhere.
 */
export default function Transcript({ lines, live, className }: TranscriptProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Scroll the log itself, never the page: scrollIntoView on mount would yank
  // the whole room down to the transcript.
  useEffect(() => {
    const log = logRef.current;
    if (!log || lines.length === 0) return;
    log.scrollTo({ top: log.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [lines.length, reduce]);

  return (
    <section
      aria-label="Live transcript"
      className={cn("flex min-h-0 flex-col", className)}
    >
      <header className="flex items-baseline justify-between border-b border-line pb-3">
        <h2 className="eyebrow">Transcript</h2>
        <span className="eyebrow tabular">
          {lines.length === 0
            ? live
              ? "Listening"
              : "Empty"
            : `${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
        </span>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="min-h-0 flex-1 overflow-y-auto py-5 [scrollbar-width:thin]"
      >
        {lines.length === 0 ? (
          <p className="max-w-xs text-sm leading-relaxed text-ink-3">
            {live
              ? "Every finished sentence lands here as it is said."
              : "Once the call starts, the conversation is written down here as it happens."}
          </p>
        ) : (
          <ol className="space-y-5">
            {lines.map((line, i) => {
              const mine = line.role === "user";
              return (
                <motion.li
                  key={i}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="grid grid-cols-[4.5rem_1fr] gap-4 sm:grid-cols-[6rem_1fr]"
                >
                  <span
                    className={cn(
                      "eyebrow truncate pt-1",
                      mine ? "text-ink" : "text-signal",
                    )}
                  >
                    {mine ? "You" : "Interviewer"}
                  </span>
                  <p
                    className={cn(
                      "text-[15px] leading-relaxed",
                      mine ? "text-ink-2" : "text-ink",
                    )}
                  >
                    {line.text}
                  </p>
                </motion.li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
