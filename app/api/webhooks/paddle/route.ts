import { applyBillingEvent } from "@/lib/billing/applyEvent";
import { verifyAndParseWebhook } from "@/lib/billing";
import { WebhookRejectedError, type ParsedBillingEvent } from "@/lib/billing/types";
import {
  claimBillingEvent,
  markBillingEventProcessed,
  releaseBillingEvent,
} from "@/lib/database/billing";

// Verification, a claim, a few writes and the answer: well under the five
// seconds the provider gives before it retries.
export const maxDuration = 30;

const LOG = "[CVision][webhook] paddle:";

/**
 * The billing provider's events. Public in the middleware; the caller is
 * authenticated by the signature over the exact request bytes, which is why
 * the body is read as text before anything parses it.
 *
 * Idempotent by the event id: the first delivery claims the event and
 * applies it, a repeat (deliveries repeat, and arrive out of order) finds
 * it claimed or processed and is acknowledged. A claim that fails to apply
 * is released and answered 500, so the provider's retry takes it again; a
 * handler that dies mid-way leaves a claim that a retry may take over once
 * it is stale. Only the ids, the type and the outcome are logged.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  let event: ParsedBillingEvent;
  try {
    event = await verifyAndParseWebhook(rawBody, request.headers);
  } catch (error) {
    if (error instanceof WebhookRejectedError) {
      console.warn(`${LOG} rejected a delivery with a bad, stale or missing signature`);
      return new Response(null, { status: 400 });
    }
    // Secret or key not configured: a retry after the fix can succeed.
    console.error(`${LOG} cannot verify deliveries:`, error);
    return new Response(null, { status: 500 });
  }

  const tag = `event=${event.eventId} type=${event.type}`;
  try {
    const claim = await claimBillingEvent(event);
    if (claim === "duplicate") {
      console.info(`${LOG} ${tag}: duplicate, acknowledged`);
      return Response.json({ ok: true });
    }
  } catch (error) {
    console.error(`${LOG} ${tag}: could not record the event:`, error);
    return new Response(null, { status: 500 });
  }

  try {
    const outcome = await applyBillingEvent(event);
    await markBillingEventProcessed(event.eventId, outcome.userId);
    console.info(`${LOG} ${tag} user=${outcome.userId ?? "-"}: ${outcome.action}`);
    return Response.json({ ok: true });
  } catch (error) {
    console.error(`${LOG} ${tag}: failed to apply, released for retry:`, error);
    await releaseBillingEvent(event.eventId).catch((releaseError) => {
      console.error(`${LOG} ${tag}: could not release the claim:`, releaseError);
    });
    return new Response(null, { status: 500 });
  }
}
