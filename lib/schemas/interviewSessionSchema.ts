import { z } from "zod";
import { INTERVIEW_LANGUAGES } from "@/lib/ai/postingLanguage";

/**
 * What `POST /api/interview/[id]/session` answers on success. The route
 * builds it and the room parses it: a 2xx whose body is not this shape is
 * treated as a failed start, never as a session.
 */
export const interviewSessionResponseSchema = z.object({
  connectionType: z.literal("webrtc"),
  /** Pass to the browser SDK as `conversationToken`. Single use, short-lived. */
  conversationToken: z.string().min(1),
  conversationId: z.string().min(1),
  /** Pass through as `dynamicVariables`, untouched; the server keeps its own copy. */
  dynamicVariables: z.record(z.string(), z.string()),
  /** The one config override the agent accepts: `overrides.agent.language`. */
  language: z.enum(INTERVIEW_LANGUAGES),
  expiresAt: z.string(),
  maxDurationSeconds: z.number().int().positive(),
});

export type InterviewSessionResponse = z.infer<typeof interviewSessionResponseSchema>;

/**
 * What `GET /api/interview/[id]/status` answers: enough for the feedback
 * page to know whether it would render differently. `status` is the Prisma
 * enum, kept as a string here so the browser never imports the client.
 */
export const interviewStatusSnapshotSchema = z.object({
  status: z.string().min(1),
  hasFeedback: z.boolean(),
  startCount: z.number().int().min(0),
  failureReason: z.string().nullable(),
});

export type InterviewStatusSnapshot = z.infer<typeof interviewStatusSnapshotSchema>;
