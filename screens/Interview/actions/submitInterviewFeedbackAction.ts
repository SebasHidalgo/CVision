"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { generateJson } from "@/lib/ai/client";
import {
  interviewFeedbackPrompt,
  interviewFeedbackSystemPrompt,
} from "@/lib/ai/prompts/interview-feedback.prompt";
import { computeTotalScore, feedbackSchema } from "@/lib/ai/schemas";
import {
  fetchInterviewById,
  saveInterviewFeedback,
} from "@/lib/database/interview";
import { NotFoundError, TranscriptTooLongError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import {
  isTranscriptTooLong,
  submitInterviewFeedbackInputSchema,
} from "@/lib/schemas/interviewSchema";
import type { ActionResult } from "@/types/action";

const FEEDBACK_TIMEOUT_MS = 90_000;

/** Closes the interview and generates its feedback from the transcript. */
export async function submitInterviewFeedbackAction(
  input: unknown
): Promise<ActionResult<{ feedbackId: string }>> {
  try {
    await requireUserId();

    const parsed = submitInterviewFeedbackInputSchema.safeParse(input);
    if (!parsed.success) {
      throw isTranscriptTooLong(parsed.error)
        ? new TranscriptTooLongError()
        : new ValidationError("Invalid feedback input");
    }

    const { interviewId, transcript, recordingUrl } = parsed.data;

    // Gate the model call: a foreign or already-scored interview must cost
    // nothing. The owner-scoped write below stays as the final guard.
    const interview = await fetchInterviewById(interviewId);
    if (!interview) throw new NotFoundError("Interview not found");
    if (interview.finalized) {
      throw new ValidationError("Interview already has feedback");
    }

    const formattedTranscript = transcript
      .map((sentence) => `- ${sentence.role}: ${sentence.content}\n`)
      .join("");

    const aiFeedback = await generateJson({
      prompt: interviewFeedbackPrompt(formattedTranscript),
      system: interviewFeedbackSystemPrompt,
      schema: feedbackSchema,
      timeoutMs: FEEDBACK_TIMEOUT_MS,
    });

    const feedbackId = await saveInterviewFeedback({
      interviewId,
      feedback: {
        ...aiFeedback,
        // Derived here, not asked of the model: it answered with totals that
        // did not match its own category scores.
        totalScore: computeTotalScore(aiFeedback.categoryScores),
      },
      recordingUrl,
    });

    revalidatePath("/interviews");

    return { ok: true, data: { feedbackId } };
  } catch (error) {
    return toActionError(error, "Failed to submit interview feedback");
  }
}
