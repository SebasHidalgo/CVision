import { z } from "zod";

export const MAX_TRANSCRIPT_MESSAGES = 400;
const MAX_TRANSCRIPT_MESSAGE_CHARS = 2_000;
// ~5x a 12-minute interview (~11k chars): bounds what a single feedback call
// can send to the model.
const MAX_TRANSCRIPT_TOTAL_CHARS = 60_000;

/** Only the id travels; role and description are read server-side. */
export const createInterviewInputSchema = z.object({
  resumeId: z.uuid(),
});

export type CreateInterviewInput = z.infer<typeof createInterviewInputSchema>;

const transcriptMessageSchema = z.object({
  role: z.enum(["user", "system", "assistant"]),
  content: z.string().max(MAX_TRANSCRIPT_MESSAGE_CHARS),
});

/** No userId: identity comes from the session, not from the client. */
export const submitInterviewFeedbackInputSchema = z.object({
  interviewId: z.uuid(),
  transcript: z
    .array(transcriptMessageSchema)
    .min(1)
    .max(MAX_TRANSCRIPT_MESSAGES)
    .refine(
      (messages) =>
        messages.reduce((total, { content }) => total + content.length, 0) <=
        MAX_TRANSCRIPT_TOTAL_CHARS,
      "Transcript exceeds the total length limit",
    ),
  recordingUrl: z.url().optional(),
});

/**
 * True when any transcript size limit failed: per message, message count, or
 * the total-length refine (the only custom check on `transcript`).
 */
export function isTranscriptTooLong(error: z.ZodError): boolean {
  return error.issues.some(
    (issue) =>
      issue.path[0] === "transcript" &&
      (issue.code === "too_big" || issue.code === "custom"),
  );
}

export type SubmitInterviewFeedbackInput = z.infer<
  typeof submitInterviewFeedbackInputSchema
>;

export const techstackSchema = z.array(z.string().min(1).max(60)).max(30);
