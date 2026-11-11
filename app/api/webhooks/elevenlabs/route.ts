import { after } from "next/server";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import { storeConversationTranscript } from "@/lib/database/interviewTranscript";
import { verifyAndParseWebhook, WebhookRejectedError, type VoiceWebhookEvent } from "@/lib/voice";

// The response goes out after the store; feedback generation runs in
// after(), which the platform keeps alive up to this limit: a 45 s model
// call, a second one when the first was not in English, and two writes.
export const maxDuration = 105;

const LOG = "[CVision][webhook] elevenlabs:";

/**
 * Post-call webhook. Public in the middleware; the caller is authenticated by
 * the HMAC signature over the exact request bytes, which is why the body is
 * read as text before anything parses it.
 *
 * Only a signature failure or a failed write answers with a non-200. A
 * payload that cannot be matched or read is acknowledged and logged with its
 * conversation id: the provider retries non-200s and disables the webhook after
 * repeated failures, and a transcript can be fetched by id from its API later.
 * Nothing in the payload is logged beyond ids, counts and outcomes.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  let event: VoiceWebhookEvent;
  try {
    event = await verifyAndParseWebhook(rawBody, request.headers);
  } catch (error) {
    if (error instanceof WebhookRejectedError) {
      console.warn(`${LOG} rejected a delivery with a bad or missing signature`);
      return new Response(null, { status: 401 });
    }
    // Secret not configured: a retry after the fix can succeed.
    console.error(`${LOG} cannot verify deliveries:`, error);
    return new Response(null, { status: 500 });
  }

  if (event.kind === "ignored") {
    console.info(`${LOG} ignored event type=${event.type}`);
    return Response.json({ ok: true });
  }
  if (event.kind === "unreadable") {
    // Paths only: the values carry the transcript.
    console.error(`${LOG} payload outside the expected shape at ${event.paths.join(", ")}; acknowledged without storing`);
    return Response.json({ ok: true });
  }

  const record = event.record;
  try {
    const result = await storeConversationTranscript({ data: record, eventTimestamp: event.deliveredAt });

    switch (result.outcome) {
      case "stored":
        console.info(
          `${LOG} stored conversation=${record.conversationId} interview=${result.interviewId} status=${result.status} turns=${record.turns.length}`,
        );
        if (result.status === "FEEDBACK_PENDING") {
          // Respond first, generate after. No retry here: the feedback page
          // re-triggers an interview it finds still pending, and the
          // generator's claim makes the two paths safe together.
          const interviewId = result.interviewId;
          after(async () => {
            try {
              const outcome = await generateInterviewFeedback(interviewId);
              console.info(`${LOG} feedback for interview=${interviewId}: ${outcome.kind}`);
            } catch (error) {
              console.error(`${LOG} feedback for interview=${interviewId} threw:`, error);
            }
          });
        }
        break;
      case "duplicate":
        console.info(`${LOG} duplicate delivery for conversation=${record.conversationId} interview=${result.interviewId}, ignored`);
        break;
      case "unmatched":
        console.warn(`${LOG} no interview for conversation=${record.conversationId}, acknowledged without storing`);
        break;
    }
    return Response.json({ ok: true });
  } catch (error) {
    // A failed write is worth a retry from the platform.
    console.error(`${LOG} failed to store conversation=${record.conversationId}:`, error);
    return new Response(null, { status: 500 });
  }
}
