import { CAP } from "@/components/interview/ui";
import { cn } from "@/lib/utils";

/** One entry of a call as it is listed: a spoken line, or the marker where a dropped call was resumed. */
export type TranscriptEntry =
  | { kind: "line"; key: string | number; who: "interviewer" | "candidate"; text: string; /** "4:05", under the label. */ at?: string | null }
  | { kind: "marker"; key: string | number };

export type TranscriptLabels = { interviewer: string; candidate: string; resumed?: string };

/**
 * A call's lines as the room, the feedback page and the landing list them: who on the left, the words on the right.
 * The label column is as wide as the longest label in this language; a time sits under its label, never over the text.
 * Presentational only (labels come in), so a server page and a client room render the same markup.
 */
export function TranscriptLines({
  entries,
  labels,
  animate = false,
  className,
}: {
  entries: readonly TranscriptEntry[];
  labels: TranscriptLabels;
  /** New lines fade in (the live room and the landing's excerpt). */
  animate?: boolean;
  className?: string;
}) {
  return (
    <ol className={cn("grid grid-cols-1 gap-y-4 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-6 sm:gap-y-5", className)}>
      {entries.map((entry) => {
        if (entry.kind === "marker") {
          return (
            <li key={entry.key} data-transcript-marker className={cn(CAP, "flex items-center gap-4 text-ed-ink-2 sm:col-span-2")}>
              <span aria-hidden className="h-px flex-1 bg-ed-line" />
              {labels.resumed}
              <span aria-hidden className="h-px flex-1 bg-ed-line" />
            </li>
          );
        }
        const mine = entry.who === "candidate";
        return (
          <li
            key={entry.key}
            data-transcript-line={entry.who}
            className={cn("grid grid-cols-1 gap-y-1 sm:col-span-2 sm:grid-cols-subgrid", animate && "animate-ed-fade motion-reduce:animate-none")}
          >
            <span className={cn(CAP, "flex gap-2.5 whitespace-nowrap pt-[3px] sm:flex-col sm:gap-[3px]")}>
              <span className={mine ? "text-ed-ink-2" : "text-ed-ink"}>{mine ? labels.candidate : labels.interviewer}</span>
              {entry.at && <span className="tabular-nums text-ed-ink-2">{entry.at}</span>}
            </span>
            <p className={cn("min-w-0 max-w-[68ch] text-ed-body leading-[1.6] [overflow-wrap:anywhere]", mine ? "text-ed-ink-2" : "text-ed-ink")}>
              {entry.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
