"use client";

import { cn } from "@/lib/utils";
import { clock } from "./talk";
import { CAP } from "./ui";
import type { SpokenLine } from "./useTalkScript";

/**
 * Lines as the app lists them: who on the left, the words on the right; the label column is as wide as the longest
 * label in this language. `timed` adds the call time under the label, as the feedback page's transcript does.
 */
export function TranscriptList({
  lines,
  labels,
  timed = false,
  className,
}: {
  lines: readonly SpokenLine[];
  labels: { interviewer: string; you: string };
  timed?: boolean;
  className?: string;
}) {
  return (
    <ol className={cn("grid grid-cols-1 gap-y-3.5 lg:grid-cols-[max-content_minmax(0,1fr)] lg:gap-x-5 lg:gap-y-4", className)}>
      {lines.map((l) => {
        const mine = l.who === "c";
        const who = mine ? labels.you : labels.interviewer;
        return (
          <li key={l.id} className={cn("col-span-full grid grid-cols-1 gap-y-0.5 lg:grid-cols-subgrid", !timed && "animate-ed-fade motion-reduce:animate-none")}>
            <span className={cn(CAP, "whitespace-nowrap pt-[3px]", mine ? "text-ed-ink-2" : "text-ed-ink", timed && "flex gap-2.5 lg:flex-col lg:gap-[3px]")}>
              {timed ? (
                <>
                  <span>{who}</span>
                  <span className="tabular-nums text-ed-ink-2">{clock(l.at)}</span>
                </>
              ) : (
                who
              )}
            </span>
            <p className={cn("text-[15px] leading-[1.6] [overflow-wrap:anywhere]", mine ? "text-ed-ink-2" : "text-ed-ink")}>{l.text}</p>
          </li>
        );
      })}
    </ol>
  );
}
