import "server-only";

import prisma from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { handleError } from "@/lib/error/handleError";

/**
 * The `User` row is the anchor every other row of an account hangs from.
 * The Clerk webhook writes it on `user.created`, but locally the webhook
 * may not be registered and in production it may arrive late, so every
 * action that inserts a row keyed by `userId` makes sure it exists first.
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

/**
 * Webhook only, no session: the id is Clerk's, verified by the delivery's
 * signature. Idempotent, like every webhook handler must be.
 */
export async function upsertUserById(userId: string): Promise<void> {
  try {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
    });
  } catch (error) {
    handleError(error, `Failed to upsert the user row (user=${userId})`);
  }
}

/** Webhook only, no session: whether an account with this id exists (billing events name users by id). */
export async function userExists(userId: string): Promise<boolean> {
  try {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    return row !== null;
  } catch (error) {
    handleError(error, `Failed to look up the user row (user=${userId})`);
  }
}

/**
 * Webhook only, no session. Removes the account's row; the foreign keys
 * cascade to its analyses, feedback, interviews and interview feedback.
 * False when there was no row, which a retried delivery must treat as done.
 */
export async function deleteUserRows(userId: string): Promise<boolean> {
  try {
    const result = await prisma.user.deleteMany({ where: { id: userId } });
    return result.count === 1;
  } catch (error) {
    handleError(error, `Failed to delete the user rows (user=${userId})`);
  }
}
