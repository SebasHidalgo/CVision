import Eyebrow from "@/components/layout/Eyebrow";
import type { TranscriptTurn } from "@/lib/elevenlabs/postCall";
import { cn } from "@/lib/utils";

type TranscriptSectionProps = {
  turns: TranscriptTurn[];
};

/** "4:05" from the platform's seconds-into-call. */
function stamp(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The stored transcript, collapsed under the report: the report quotes from
 * it, and the candidate can check any quote against the whole exchange.
 */
export default function TranscriptSection({ turns }: TranscriptSectionProps) {
  const spoken = turns.filter(
    (turn) => typeof turn.message === "string" && turn.message.trim() !== "",
  );
  if (spoken.length === 0) return null;

  return (
    <details className="group border-t border-line py-10 lg:py-12">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 [&::-webkit-details-marker]:hidden">
        <Eyebrow tick as="span">Transcript</Eyebrow>
        <span className="eyebrow tabular">
          {spoken.length} {spoken.length === 1 ? "line" : "lines"} ·{" "}
          <span className="group-open:hidden">show</span>
          <span className="hidden group-open:inline">hide</span>
        </span>
      </summary>

      <ol className="mt-8 space-y-5">
        {spoken.map((turn, i) => {
          const mine = turn.role === "user";
          const time = stamp(turn.time_in_call_secs);
          return (
            <li
              key={i}
              className="grid grid-cols-[5.5rem_1fr] gap-4 sm:grid-cols-[7.5rem_1fr]"
            >
              <span className={cn("eyebrow pt-1", mine ? "text-ink" : "text-signal")}>
                {mine ? "You" : "Interviewer"}
                {time && <span className="ml-2 text-ink-3 tabular">{time}</span>}
              </span>
              <p className={cn("text-[15px] leading-relaxed", mine ? "text-ink-2" : "text-ink")}>
                {turn.message}
              </p>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
