import "server-only";

import prisma from "@/lib/prisma";
import { handleError } from "@/lib/error/handleError";

/**
 * The `User` row by its Clerk id, without a session: for the Clerk and
 * billing webhooks (the id comes from a delivery whose signature was
 * verified), the deletion routine and the scripts. Nothing here imports
 * `lib/auth`, which is what keeps `lib/deletion` loadable from a script.
 * The session-scoped `ensureUser` lives in user.ts.
 */

/** Idempotent, like every webhook handler must be. */
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

/** Whether an account with this id exists (billing events name users by id). */
export async function userExists(userId: string): Promise<boolean> {
  try {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    return row !== null;
  } catch (error) {
    handleError(error, `Failed to look up the user row (user=${userId})`);
  }
}

export type UserListing = { id: string; createdAt: Date };

/**
 * One page of accounts created before a cutoff, in id order after a cursor:
 * the user reconcile walks the table with these, a page at a time.
 */
export async function listUsersCreatedBefore(params: {
  createdBefore: Date;
  afterId: string | null;
  take: number;
}): Promise<UserListing[]> {
  try {
    return await prisma.user.findMany({
      where: {
        createdAt: { lt: params.createdBefore },
        ...(params.afterId ? { id: { gt: params.afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take: params.take,
      select: { id: true, createdAt: true },
    });
  } catch (error) {
    handleError(error, "Failed to list user rows");
  }
}

/** Accounts created at or after a cutoff (the reconcile leaves them for a later run). */
export async function countUsersCreatedSince(since: Date): Promise<number> {
  try {
    return await prisma.user.count({ where: { createdAt: { gte: since } } });
  } catch (error) {
    handleError(error, "Failed to count recent user rows");
  }
}

/**
 * Removes the account's row; the foreign keys cascade to its analyses,
 * feedback, interviews, interview feedback, usage and billing rows. False
 * when there was no row, which a retried delivery must treat as done.
 */
export async function deleteUserRows(userId: string): Promise<boolean> {
  try {
    const result = await prisma.user.deleteMany({ where: { id: userId } });
    return result.count === 1;
  } catch (error) {
    handleError(error, `Failed to delete the user rows (user=${userId})`);
  }
}
