import { z } from "zod";

/** One stored turn, kept loose on purpose: the row stores the array verbatim. */
export const transcriptTurnSchema = z.looseObject({
  role: z.string(),
  message: z.string().nullish(),
  time_in_call_secs: z.number().nullish(),
});

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;
