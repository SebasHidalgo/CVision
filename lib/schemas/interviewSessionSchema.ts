import { z } from "zod";
import { INTERVIEW_LANGUAGES } from "@/lib/ai/postingLanguage";

/**
 * What `POST /api/interview/[id]/session` answers on success. The route
 * builds it and the room parses it: a 2xx whose body is not this shape is
 * treated as a failed start, never as a session.
 */
/** What the room posts to start: the language the candidate chose. Absent keeps the interview's, or the posting's. */
export const interviewSessionRequestSchema = z.object({
  language: z.enum(INTERVIEW_LANGUAGES).optional(),
});

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
  /** The length of this call: the tier's on a first start, what is left of it on a resumed one. */
  maxDurationSeconds: z.number().int().positive(),
  /** This call continues an interview whose earlier call dropped. */
  resumed: z.boolean().optional(),
  /** What paid for this interview's unit: the room shows it, and says so if it differs from what the page promised. */
  source: z.enum(["period", "credit", "trial"]),
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

/**
 * What the room posts to `POST /api/interview/[id]/ended` when the call
 * ends: the SDK's disconnect reason, for the log, and how the room read the
 * end. `finish` is the candidate's own decision (End, or "Finish and get
 * feedback"); `drop` opens the resume window. Neither is trusted for more
 * than that: the platform's record decides what is scored.
 */
export const interviewEndedRequestSchema = z.object({
  reason: z.string().trim().max(40).optional(),
  outcome: z.enum(["finish", "drop"]).optional(),
});

/** What the ended endpoint answers. `finalized`: the interview is now being scored. */
export const interviewEndedResponseSchema = z.object({
  recorded: z.boolean(),
  finalized: z.boolean().optional(),
});

export type InterviewEndedRequest = z.infer<typeof interviewEndedRequestSchema>;
