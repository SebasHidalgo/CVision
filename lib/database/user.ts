import "server-only";

import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { handleError } from "@/lib/error/handleError";

/**
 * The `User` row is the anchor every other row of an account hangs from.
 * The Clerk webhook writes it on `user.created` (userById.ts, no session),
 * but locally the webhook may not be registered and in production it may
 * arrive late, so every action that inserts a row keyed by `userId` makes
 * sure it exists first.
 */

/** Idempotent: the caller's row, created if missing. Identity from the session. */
export async function ensureUser(): Promise<string> {
  try {
    const userId = await requireUserId();

    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
    });

    return userId;
  } catch (error) {
    handleError(error, "Failed to ensure the user row");
  }
}
