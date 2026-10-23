import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { upsertUserById } from "@/lib/database/userById";
import { deleteAccountCascade } from "@/lib/deletion";

const LOG = "[CVision][webhook] clerk:";

/**
 * Clerk's user lifecycle. Public in the middleware; the caller is
 * authenticated by the Svix signature over the raw body, which the SDK
 * verifies against CLERK_WEBHOOK_SIGNING_SECRET. Two events matter:
 * `user.created` writes the account's row, `user.deleted` removes it and
 * everything that hangs from it. Anything else is acknowledged. Every
 * branch is idempotent: Clerk retries non-2xx answers, and a retried
 * deletion for an account already gone must answer 200.
 */
export async function POST(request: NextRequest) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
    // Operator error, not a bad delivery: a retry after the fix succeeds.
    console.error(`${LOG} CLERK_WEBHOOK_SIGNING_SECRET is not set`);
    return new Response(null, { status: 500 });
  }

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request);
  } catch {
    console.warn(`${LOG} rejected a delivery with a bad or missing signature`);
    return new Response(null, { status: 400 });
  }

  // Svix's delivery id, so a failure line can be matched to a delivery in
  // the Clerk dashboard; the user id is the other handle, where there is one.
  const deliveryId = request.headers.get("svix-id") ?? "?";
  const userId = (event.data as { id?: unknown }).id;
  const who = `delivery=${deliveryId} user=${typeof userId === "string" ? userId : "?"}`;

  try {
    switch (event.type) {
      case "user.created": {
        await upsertUserById(event.data.id);
        console.info(`${LOG} user.created ${who}`);
        break;
      }
      case "user.deleted": {
        if (!event.data.id) {
          console.warn(`${LOG} user.deleted without an id, acknowledged ${who}`);
          break;
        }
        // Rows, the CVs in the bucket and the conversations on the voice
        // platform; nothing refused, the account is gone. Idempotent.
        const summary = await deleteAccountCascade(event.data.id);
        console.info(
          `${LOG} user.deleted ${who} subscriptionsCanceled=${summary.subscriptionsCanceled} subscriptionsFailed=${summary.subscriptionsFailed} analyses=${summary.analyses} userRow=${summary.userRowRemoved ? "removed" : "already gone"}`,
        );
        break;
      }
      default:
        console.info(`${LOG} ignored event type=${event.type} ${who}`);
    }
    return Response.json({ ok: true });
  } catch (error) {
    // A failed write is worth a retry from Clerk.
    console.error(`${LOG} failed to handle ${event.type} ${who}:`, error);
    return new Response(null, { status: 500 });
  }
}
