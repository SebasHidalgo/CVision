"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type TranscriptMessage = {
  role: "user" | "system" | "assistant";
  content: string;
};

type TranscriptProps = {
  messages: TranscriptMessage[];
  userName: string;
  live: boolean;
  className?: string;
};

/** The conversation as a script: speaker in the margin, line beside it. */
export default function Transcript({
  messages,
  userName,
  live,
  className,
}: TranscriptProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Scroll the log itself, never the page: scrollIntoView on mount would yank
  // the whole room down to the transcript.
  useEffect(() => {
    const log = logRef.current;
    if (!log || messages.length === 0) return;
    log.scrollTo({ top: log.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages.length, reduce]);

  return (
    <section
      aria-label="Transcript"
      className={cn("flex min-h-0 flex-col", className)}
    >
      <header className="flex items-baseline justify-between border-b border-line pb-3">
        <h2 className="eyebrow">Transcript</h2>
        <span className="eyebrow tabular">
          {messages.length === 0
            ? live
              ? "Listening"
              : "Empty"
            : `${messages.length} ${messages.length === 1 ? "line" : "lines"}`}
        </span>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="min-h-0 flex-1 overflow-y-auto py-5 [scrollbar-width:thin]"
      >
        {messages.length === 0 ? (
          <p className="max-w-xs text-sm leading-relaxed text-ink-3">
            {live
              ? "Every finished sentence lands here as it is said."
              : "Once the call starts, the conversation is written down here in real time."}
          </p>
        ) : (
          <ol className="space-y-5">
            {messages.map((message, i) => {
              const mine = message.role === "user";
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
                    {mine ? userName : "Interviewer"}
                  </span>
                  <p
                    className={cn(
                      "text-[15px] leading-relaxed",
                      mine ? "text-ink-2" : "text-ink",
                    )}
                  >
                    {message.content}
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
