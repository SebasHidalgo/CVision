import { z } from "zod";
import { resumeFeedbackSchema } from "@/lib/schemas/resumeSchema";

/** Only the id travels; role and description are read server-side. */
export const createInterviewInputSchema = z.object({
  resumeId: z.uuid(),
});

export type CreateInterviewInput = z.infer<typeof createInterviewInputSchema>;

/** Display chips on the interview list: short names, a bounded number. */
export const MAX_TECHSTACK_ITEMS = 30;
export const MAX_TECHSTACK_ITEM_CHARS = 60;
export const techstackSchema = z
  .array(z.string().min(1).max(MAX_TECHSTACK_ITEM_CHARS))
  .max(MAX_TECHSTACK_ITEMS);

/**
 * The parts of a stored analysis the interviewer is briefed with. Rows saved
 * before validation existed can have no feedback at all; a row that fails
 * this is treated the same way.
 */
export const interviewContextSchema = resumeFeedbackSchema.pick({
  overall: true,
  jobFit: true,
});
