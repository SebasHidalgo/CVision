import { z } from "zod";

/** One stored turn. Loose so rows stored before M10-F, with every platform field, still read. */
export const transcriptTurnSchema = z.looseObject({
  role: z.string(),
  message: z.string().nullish(),
  time_in_call_secs: z.number().nullish(),
});

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

/** The three fields the app reads of a turn; the platform sends about 35. */
export const STORED_TURN_FIELDS = ["role", "message", "time_in_call_secs"] as const;

/** A line with something said: a letter or a digit. A turn cut off before its first word is recorded as "...". */
export const hasWords = (text: unknown): text is string => typeof text === "string" && /[\p{L}\p{N}]/u.test(text);

/** Turns as the app stores them: who spoke, what, and when. Turns without words (tool calls, results, a cut-off "...") are not kept. */
export function trimStoredTurns(turns: readonly unknown[]): TranscriptTurn[] {
  return turns.flatMap((turn) => {
    if (typeof turn !== "object" || turn === null) return [];
    const { role, message, time_in_call_secs: at } = turn as Record<string, unknown>;
    if (typeof role !== "string" || !hasWords(message)) return [];
    return [{ role, message, ...(typeof at === "number" ? { time_in_call_secs: at } : {}) }];
  });
}
