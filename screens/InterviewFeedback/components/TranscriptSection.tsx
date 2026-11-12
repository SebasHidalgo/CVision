import type { TFunction } from "i18next";
import Eyebrow from "@/components/layout/Eyebrow";
import type { TranscriptTurn } from "@/lib/voice/postCall";
import { isResumeMarker } from "@/lib/voice/segments";
import { cn } from "@/lib/utils";

type TranscriptSectionProps = {
  turns: TranscriptTurn[];
  /** The report's feedback-namespace t: a sync child, so the report renders in one pass. */
  t: TFunction<"feedback">;
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
export default function TranscriptSection({ turns, t }: TranscriptSectionProps) {
  const spoken = turns.filter(
    (turn) => typeof turn.message === "string" && turn.message.trim() !== "",
  );
  if (spoken.length === 0) return null;

  return (
    <details className="group border-t border-line py-10 lg:py-12">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 [&::-webkit-details-marker]:hidden">
        <Eyebrow tick as="span">{t("transcript.title")}</Eyebrow>
        <span className="eyebrow tabular">
          {t("transcript.lines", { count: spoken.filter((turn) => !isResumeMarker(turn)).length })} ·{" "}
          <span className="group-open:hidden">{t("transcript.show")}</span>
          <span className="hidden group-open:inline">{t("transcript.hide")}</span>
        </span>
      </summary>

      {/* The label column is as wide as the longest label in this language; the time sits under the label, never over the text. */}
      <ol className="mt-8 grid grid-cols-1 gap-y-5 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-6">
        {spoken.map((turn, i) => {
          if (isResumeMarker(turn)) {
            return (
              <li key={i} className="eyebrow flex items-center gap-4 text-ink-3 sm:col-span-2">
                <span aria-hidden className="h-px flex-1 bg-line" />
                {t("transcript.resumed")}
                <span aria-hidden className="h-px flex-1 bg-line" />
              </li>
            );
          }
          const mine = turn.role === "user";
          const time = stamp(turn.time_in_call_secs);
          return (
            <li key={i} className="grid gap-1 sm:col-span-2 sm:grid-cols-subgrid sm:gap-x-6">
              <span className="eyebrow flex items-baseline gap-3 pt-1 whitespace-nowrap sm:flex-col sm:gap-1">
                <span className={mine ? "text-ink" : "text-signal"}>{mine ? t("transcript.you") : t("transcript.interviewer")}</span>
                {time && <span className="text-ink-3 tabular">{time}</span>}
              </span>
              <p className={cn("min-w-0 text-[15px] leading-relaxed break-words", mine ? "text-ink-2" : "text-ink")}>
                {turn.message}
              </p>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
