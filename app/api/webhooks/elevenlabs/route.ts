import { storeConversationTranscript } from "@/lib/database/interviewTranscript";
import { verifyWebhookEvent, WebhookRejectedError } from "@/lib/elevenlabs/client";
import {
  POST_CALL_TRANSCRIPTION,
  postCallEventSchema,
  postCallTranscriptionSchema,
} from "@/lib/elevenlabs/postCall";

// Signature check and two database round trips; nothing slow belongs here.
export const maxDuration = 30;

const LOG = "[CVision][webhook] elevenlabs:";

/**
 * Post-call webhook. Public in the middleware; the caller is authenticated by
 * the HMAC signature over the exact request bytes, which is why the body is
 * read as text before anything parses it.
 *
 * Only a signature failure or a failed write answers with a non-200. A
 * payload that cannot be matched or read is acknowledged and logged with its
 * conversation id: ElevenLabs retries non-200s and disables the webhook after
 * repeated failures, and a transcript can be fetched by id from its API later.
 * Nothing in the payload is logged beyond ids, counts and outcomes.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("elevenlabs-signature");

  let event: unknown;
  try {
    event = await verifyWebhookEvent(rawBody, signature);
  } catch (error) {
    if (error instanceof WebhookRejectedError) {
      console.warn(`${LOG} rejected a delivery with a bad or missing signature`);
      return new Response(null, { status: 401 });
    }
    // Secret not configured: a retry after the fix can succeed.
    console.error(`${LOG} cannot verify deliveries:`, error);
    return new Response(null, { status: 500 });
  }

  const envelope = postCallEventSchema.safeParse(event);
  if (!envelope.success) {
    console.warn(`${LOG} unrecognized event shape, acknowledged`);
    return Response.json({ ok: true });
  }
  if (envelope.data.type !== POST_CALL_TRANSCRIPTION) {
    console.info(`${LOG} ignored event type=${envelope.data.type}`);
    return Response.json({ ok: true });
  }

  const transcription = postCallTranscriptionSchema.safeParse(envelope.data.data);
  if (!transcription.success) {
    // Paths only: the values carry the transcript.
    const paths = transcription.error.issues.map((issue) => issue.path.join(".") || "(root)");
    console.error(
      `${LOG} transcription payload outside the expected shape at ${paths.join(", ")}; acknowledged without storing`,
    );
    return Response.json({ ok: true });
  }

  const data = transcription.data;
  try {
    const result = await storeConversationTranscript({
      data,
      eventTimestamp: envelope.data.event_timestamp,
    });

    switch (result.outcome) {
      case "stored":
        console.info(
          `${LOG} stored conversation=${data.conversation_id} interview=${result.interviewId} status=${result.status} turns=${data.transcript.length}`,
        );
        break;
      case "duplicate":
        console.info(
          `${LOG} duplicate delivery for conversation=${data.conversation_id} interview=${result.interviewId}, ignored`,
        );
        break;
      case "unmatched":
        console.warn(
          `${LOG} no interview for conversation=${data.conversation_id}, acknowledged without storing`,
        );
        break;
    }
    return Response.json({ ok: true });
  } catch (error) {
    // A failed write is worth a retry from the platform.
    console.error(`${LOG} failed to store conversation=${data.conversation_id}:`, error);
    return new Response(null, { status: 500 });
  }
}
