"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Wall-clock stages, not real progress: the analysis is one synchronous call
// and the model reports nothing back until it is done.
const STAGES = [
  { at: 0, text: "Reading the text layer of your PDF" },
  { at: 5, text: "Comparing it with the posting, requirement by requirement" },
  { at: 20, text: "Scoring six dimensions" },
  { at: 45, text: "Writing the verdict and the priority fixes" },
  { at: 85, text: "Still working. Thoroughness takes a moment" },
];

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AnalysisInProgress() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeIndex = STAGES.reduce(
    (current, stage, i) => (elapsed >= stage.at ? i : current),
    0,
  );

  return (
    <section
      role="status"
      aria-live="polite"
      className="grid gap-10 md:grid-cols-[minmax(0,15rem)_1fr] md:gap-14"
    >
      {/* The sheet being read */}
      <div
        aria-hidden
        className="relative mx-auto aspect-[3/4] w-full max-w-[15rem] overflow-hidden bg-sheet p-6 shadow-sheet"
      >
        <span className="block h-2.5 w-2/5 bg-ink" />
        <span className="mt-3 block h-[5px] w-3/5 bg-paper-3" />
        <span className="mt-2 block h-[5px] w-2/5 bg-paper-3" />
        <span className="mt-7 block h-[5px] w-full bg-paper-3" />
        <span className="mt-2 block h-[5px] w-11/12 bg-paper-3" />
        <span className="mt-2 block h-[5px] w-4/5 bg-paper-3" />
        <span className="mt-7 block h-[5px] w-full bg-paper-3" />
        <span className="mt-2 block h-[5px] w-3/4 bg-paper-3" />
        <span className="mt-2 block h-[5px] w-5/6 bg-paper-3" />

        <span className="absolute inset-x-0 top-0 h-full animate-scan">
          <span className="absolute inset-x-0 bottom-0 h-px bg-signal" />
          <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-signal/12 to-transparent" />
        </span>
      </div>

      <div>
        <div className="flex items-baseline justify-between border-b border-line pb-4">
          <h2 className="display-md text-ink">Analyzing</h2>
          <span className="eyebrow tabular text-ink">{formatElapsed(elapsed)}</span>
        </div>

        <ol className="mt-6 space-y-4">
          {STAGES.map((stage, i) => {
            const done = i < activeIndex;
            const active = i === activeIndex;
            return (
              <li
                key={stage.at}
                className={cn(
                  "flex items-start gap-4 transition-colors duration-500",
                  done ? "text-ink-3" : active ? "text-ink" : "text-ink-3/60",
                )}
              >
                <span className="mt-[0.45em] flex size-3 shrink-0 items-center justify-center">
                  {done ? (
                    <Check className="size-3" />
                  ) : (
                    <span
                      className={cn(
                        "block size-1.5",
                        active ? "bg-signal animate-blink" : "bg-line-strong",
                      )}
                    />
                  )}
                </span>
                <span className={cn(active && "font-medium")}>{stage.text}</span>
              </li>
            );
          })}
        </ol>

        <p className="eyebrow mt-8">
          Usually one to two minutes. Keep this tab open.
        </p>
      </div>
    </section>
  );
}
