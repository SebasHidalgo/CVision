import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { deleteUserRows, upsertUserById } from "@/lib/database/user";

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

  try {
    switch (event.type) {
      case "user.created": {
        await upsertUserById(event.data.id);
        console.info(`${LOG} user.created user=${event.data.id}`);
        break;
      }
      case "user.deleted": {
        const userId = event.data.id;
        if (!userId) {
          console.warn(`${LOG} user.deleted without an id, acknowledged`);
          break;
        }
        const removed = await deleteUserRows(userId);
        console.info(`${LOG} user.deleted user=${userId} rows=${removed ? "removed" : "already gone"}`);
        break;
      }
      default:
        console.info(`${LOG} ignored event type=${event.type}`);
    }
    return Response.json({ ok: true });
  } catch (error) {
    // A failed write is worth a retry from Clerk.
    console.error(`${LOG} failed to handle ${event.type}:`, error);
    return new Response(null, { status: 500 });
  }
}
