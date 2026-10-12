"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { FEEDBACK_FAILURE_REASONS, generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import { fetchInterviewById, storeClientTranscript } from "@/lib/database/interview";
import { STARTABLE_STATUSES, type TranscriptTurn } from "@/lib/elevenlabs/postCall";
import {
  InterviewAlreadyScoredError,
  InterviewContextMissingError,
  InterviewNotStartableError,
  NotFoundError,
  TranscriptEmptyError,
  TranscriptTooLongError,
} from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import {
  isTranscriptEmpty,
  isTranscriptTooLong,
  submitInterviewFeedbackInputSchema,
  type SubmitInterviewFeedbackInput,
} from "@/lib/schemas/interviewSchema";
import type { ActionResult } from "@/types/action";

/** The room's message shape into the stored turn shape; system lines are not speech. */
function toTranscriptTurns(transcript: SubmitInterviewFeedbackInput["transcript"]): TranscriptTurn[] {
  return transcript
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "user" ? "user" : "agent",
      message: message.content,
      // The room never had timings; the stats report them as not measured.
      time_in_call_secs: null,
    }));
}

/**
 * @deprecated Removed in M3-C with the Vapi room. The transcript here comes
 * from the browser and is untrusted; the row is marked `transcriptSource:
 * "browser"` so a reader knows which interviews were scored from
 * client-supplied text. Everything after storage is the same generator the
 * webhook path uses.
 */
export async function submitInterviewFeedbackAction(
  input: unknown
): Promise<ActionResult<{ feedbackId: string | null }>> {
  try {
    await requireUserId();

    const parsed = submitInterviewFeedbackInputSchema.safeParse(input);
    if (!parsed.success) {
      if (isTranscriptEmpty(parsed.error)) throw new TranscriptEmptyError();
      if (isTranscriptTooLong(parsed.error)) throw new TranscriptTooLongError();
      throw new ValidationError("Invalid feedback input");
    }

    const { interviewId, transcript, recordingUrl } = parsed.data;

    // Gate the model call: a foreign or already-scored interview must cost
    // nothing. The owner-scoped guarded write below stays as the final guard.
    const interview = await fetchInterviewById(interviewId);
    if (!interview) throw new NotFoundError("Interview not found");
    if (!STARTABLE_STATUSES.has(interview.status)) {
      if (interview.status === "FAILED" || interview.status === "EXPIRED") {
        throw new InterviewNotStartableError(`Interview is ${interview.status}`);
      }
      throw new InterviewAlreadyScoredError();
    }

    const stored = await storeClientTranscript({
      interviewId,
      turns: toTranscriptTurns(transcript),
      recordingUrl,
    });
    if (!stored) throw new InterviewAlreadyScoredError();

    const outcome = await generateInterviewFeedback(interviewId);
    revalidatePath("/interviews");

    switch (outcome.kind) {
      case "completed":
        return { ok: true, data: { feedbackId: outcome.feedbackId } };
      case "skipped":
        // Another generator holds the row; the feedback page polls for it.
        return { ok: true, data: { feedbackId: null } };
      case "retry-later":
        return { ok: false, code: outcome.code };
      case "failed":
        if (outcome.reason === FEEDBACK_FAILURE_REASONS.noCandidateTurns) {
          throw new TranscriptEmptyError("No candidate turns in the transcript");
        }
        if (outcome.reason === FEEDBACK_FAILURE_REASONS.contextMissing) {
          throw new InterviewContextMissingError();
        }
        return { ok: false, code: outcome.code ?? "UNKNOWN" };
    }
  } catch (error) {
    return toActionError(error, "Failed to submit interview feedback");
  }
}
