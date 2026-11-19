import type { TranscriptEntry } from "@/components/interview/TranscriptLines";
import { isResumeMarker } from "@/lib/voice/segments";
import { hasWords, type TranscriptTurn } from "@/lib/voice/transcript";

/** "4:05" from the platform's seconds into the call. */
export function callTime(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The report's transcript: its entries and how many lines were said. */
export type ReportTranscript = { entries: TranscriptEntry[]; lines: number };

/**
 * The stored turns as the transcript lists them: the "[call resumed]" marker between two calls, and every turn with
 * something said. A turn cut off before its first word ("...") is not a line anyone said. Null when nothing was said.
 */
export function transcriptEntries(turns: readonly TranscriptTurn[]): ReportTranscript | null {
  const entries: TranscriptEntry[] = [];
  turns.forEach((turn, i) => {
    if (isResumeMarker(turn)) {
      entries.push({ kind: "marker", key: i });
    } else if (hasWords(turn.message)) {
      entries.push({ kind: "line", key: i, who: turn.role === "user" ? "candidate" : "interviewer", text: turn.message, at: callTime(turn.time_in_call_secs) });
    }
  });
  const lines = entries.filter((entry) => entry.kind === "line").length;
  return lines > 0 ? { entries, lines } : null;
}
