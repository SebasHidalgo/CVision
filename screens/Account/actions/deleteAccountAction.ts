"use server";

import { requireUserId } from "@/lib/auth";
import { deleteClerkUser } from "@/lib/clerk/users";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { deleteAccountCascade } from "@/lib/deletion";
import { AccountDeletionFailedError } from "@/lib/error/errors";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { deleteAccountInputSchema } from "@/lib/schemas/accountSchema";
import type { ActionResult } from "@/types/action";

const LOG = "[CVision][account]";

/**
 * Deletes the caller's account from the account page. The sign-in provider
 * goes first: until Clerk confirms, nothing of ours is touched, so a
 * failure there leaves a whole account and ACCOUNT_DELETION_FAILED. Once
 * Clerk has deleted it (its sessions end, and `user.deleted` is on its way
 * to the webhook), the same cascade the webhook runs is run here, inline:
 * subscriptions canceled at the provider, analyses, CVs, interviews, the
 * voice conversations, the user row. That part is best effort: a failure is
 * logged loudly and the answer is still ok, because the account is gone and
 * the webhook and the daily users reconcile finish the job (the cascade is
 * idempotent). The client signs out after an ok.
 */
export async function deleteAccountAction(input: unknown): Promise<ActionResult<{ deleted: true }>> {
  try {
    const userId = await requireUserId();
    await assertRateLimit(userId, "accountDeletion");

    const parsed = deleteAccountInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("The account deletion was not confirmed");

    let atClerk: Awaited<ReturnType<typeof deleteClerkUser>>;
    try {
      atClerk = await deleteClerkUser(userId, { secretKey: process.env.CLERK_SECRET_KEY ?? "" });
    } catch (error) {
      throw new AccountDeletionFailedError(`Clerk did not delete user=${userId}`, { cause: error });
    }
    console.info(`${LOG} user=${userId} deleted at Clerk (${atClerk}); deleting the account's data`);

    try {
      const summary = await deleteAccountCascade(userId);
      console.info(
        `${LOG} user=${userId} account deleted from its page: analyses=${summary.analyses} subscriptionsFailed=${summary.subscriptionsFailed} conversationsFailed=${summary.conversationsFailed} userRow=${summary.userRowRemoved ? "removed" : "already gone"}`,
      );
    } catch (error) {
      console.error(`${LOG} user=${userId} DELETED AT CLERK BUT THE LOCAL CASCADE FAILED; the webhook or users:reconcile finishes it:`, error);
    }

    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return toActionError(error, "Failed to delete the account");
  }
}
