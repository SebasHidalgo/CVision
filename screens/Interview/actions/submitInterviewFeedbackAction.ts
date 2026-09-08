"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth";
import { generateJson } from "@/lib/ai/client";
import {
  interviewFeedbackPrompt,
  interviewFeedbackSystemPrompt,
} from "@/lib/ai/prompts/interview-feedback.prompt";
import { feedbackSchema } from "@/lib/ai/schemas";
import { saveInterviewFeedback } from "@/lib/database/interview";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { submitInterviewFeedbackInputSchema } from "@/lib/schemas/interviewSchema";
import type { ActionResult } from "@/types/action";

const FEEDBACK_TIMEOUT_MS = 90_000;

/** Closes the interview and generates its feedback from the transcript. */
export async function submitInterviewFeedbackAction(
  input: unknown
): Promise<ActionResult<{ feedbackId: string }>> {
  try {
    await requireUserId();

    const parsed = submitInterviewFeedbackInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid feedback input");

    const { interviewId, transcript, recordingUrl } = parsed.data;

    const formattedTranscript = transcript
      .map((sentence) => `- ${sentence.role}: ${sentence.content}\n`)
      .join("");

    const feedback = await generateJson({
      prompt: interviewFeedbackPrompt(formattedTranscript),
      system: interviewFeedbackSystemPrompt,
      schema: feedbackSchema,
      timeoutMs: FEEDBACK_TIMEOUT_MS,
    });

    const feedbackId = await saveInterviewFeedback({
      interviewId,
      feedback,
      recordingUrl,
    });

    revalidatePath("/interviews");

    return { ok: true, data: { feedbackId } };
  } catch (error) {
    return toActionError(error, "Failed to submit interview feedback");
  }
}
