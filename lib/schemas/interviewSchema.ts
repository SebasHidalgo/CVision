import { z } from "zod";

export const MAX_TRANSCRIPT_MESSAGES = 400;

/** Only the id travels; role and description are read server-side. */
export const createInterviewInputSchema = z.object({
  resumeId: z.uuid(),
});

export type CreateInterviewInput = z.infer<typeof createInterviewInputSchema>;

const transcriptMessageSchema = z.object({
  role: z.enum(["user", "system", "assistant"]),
  content: z.string().max(5000),
});

/** No userId: identity comes from the session, not from the client. */
export const submitInterviewFeedbackInputSchema = z.object({
  interviewId: z.uuid(),
  transcript: z
    .array(transcriptMessageSchema)
    .min(1)
    .max(MAX_TRANSCRIPT_MESSAGES),
  recordingUrl: z.url().optional(),
});

export type SubmitInterviewFeedbackInput = z.infer<
  typeof submitInterviewFeedbackInputSchema
>;

export const techstackSchema = z.array(z.string().min(1).max(60)).max(30);
