import "server-only";

import {
  collectDetachedConversationIds,
  deleteAnalysisRows,
  listAnalysisIdsOfUser,
} from "@/lib/database/deletion";
import { deleteUserRows } from "@/lib/database/user";
import { cancelSubscriptionNow } from "@/lib/billing";
import { deleteConversation } from "@/lib/elevenlabs/client";
import { listObjects, removeObject, removeObjects } from "@/lib/supabase/server";

/**
 * Deletion that leaves nothing behind, in one routine with two entry
 * points: the delete action (one analysis, refused while a rehearsal is
 * live) and the Clerk webhook (the whole account, nothing refused).
 *
 * Rows first, the outside world second. A row that outlives its file would
 * render a broken drawer and a dead rehearsal; a file or a platform
 * conversation that outlives its row is invisible to the user, costs
 * nothing to leave for a while, and is caught anyway: the collector removes
 * a CV with no row within a day, and the platform drops a conversation on
 * its own retention. So an external failure is logged with its ids and
 * never undoes the row deletion.
 */

const LOG = "[CVision][deletion]";

export type ConversationCleanup = { id: string; outcome: "deleted" | "not-found" | "failed" };

export type AnalysisDeletion =
  | { kind: "not-found" }
  | { kind: "deleted"; objectRemoved: boolean; conversations: ConversationCleanup[] };

export async function deleteAnalysisCascade(params: {
  analysisId: string;
  userId: string;
  /** The account is gone: a live rehearsal goes with the rest. */
  allowBusy?: boolean;
}): Promise<AnalysisDeletion> {
  const rows = await deleteAnalysisRows({
    analysisId: params.analysisId,
    userId: params.userId,
    allowBusy: params.allowBusy ?? false,
  });
  if (!rows.deleted) return { kind: "not-found" };

  const objectRemoved = await removeObject(rows.resumeKey);
  const conversations = await cleanUpConversations(rows.conversationIds);

  console.info(
    `${LOG} analysis=${params.analysisId} deleted; object ${objectRemoved ? "removed" : "LEFT (collector)"}; conversations ${describe(conversations)}`,
  );
  return { kind: "deleted", objectRemoved, conversations };
}

export type AccountDeletion = {
  analyses: number;
  /** Objects still under the account's prefix after its analyses went, and whether they were removed. */
  leftoverObjects: number;
  leftoverObjectsRemoved: boolean;
  conversationsFailed: number;
  /** Provider subscriptions canceled (or already canceled) before the rows went, and those the provider refused. */
  subscriptionsCanceled: number;
  subscriptionsFailed: number;
  userRowRemoved: boolean;
};

/**
 * Everything of one account, for `user.deleted`: the billing subscriptions
 * first (a subscription that keeps billing a deleted user is the worst
 * outcome, so this runs before the rows that remember it are gone, and a
 * failure is loud with the user id but does not stop the deletion), then
 * each analysis through the cascade above, the conversations of interviews
 * that had no analysis, any object left under `cv/{userId}/`, then the user
 * row (whose foreign keys take whatever is left, the billing rows
 * included). Idempotent: an account already gone yields zeros and
 * `userRowRemoved: false`. The provider keeps the customer, the
 * transactions and the canceled subscription for its own records.
 */
export async function deleteAccountCascade(userId: string): Promise<AccountDeletion> {
  let subscriptionsCanceled = 0;
  let subscriptionsFailed = 0;
  try {
    const billing = await cancelSubscriptionNow(userId);
    subscriptionsCanceled = billing.canceled.length;
    subscriptionsFailed = billing.failed.length;
  } catch (error) {
    subscriptionsFailed = -1;
    console.error(`${LOG} user=${userId} could not read or cancel the subscriptions at the provider; check them by hand:`, error);
  }
  if (subscriptionsFailed !== 0) {
    console.error(`${LOG} user=${userId} ACCOUNT DELETED WITH A SUBSCRIPTION POSSIBLY STILL BILLING (failed=${subscriptionsFailed})`);
  }

  const analysisIds = await listAnalysisIdsOfUser(userId);
  let conversationsFailed = 0;
  for (const analysisId of analysisIds) {
    const outcome = await deleteAnalysisCascade({ analysisId, userId, allowBusy: true });
    if (outcome.kind === "deleted") {
      conversationsFailed += outcome.conversations.filter((c) => c.outcome === "failed").length;
    }
  }

  const detached = await cleanUpConversations(await collectDetachedConversationIds(userId));
  conversationsFailed += detached.filter((c) => c.outcome === "failed").length;

  let leftoverObjects = 0;
  let leftoverObjectsRemoved = true;
  try {
    const leftovers = await listObjects(`cv/${userId}`);
    leftoverObjects = leftovers.length;
    if (leftovers.length > 0) await removeObjects(leftovers.map((object) => object.key));
  } catch (error) {
    leftoverObjectsRemoved = false;
    console.error(`${LOG} user=${userId} leftover objects not removed (collector):`, error instanceof Error ? error.name : error);
  }

  const userRowRemoved = await deleteUserRows(userId);

  console.info(
    `${LOG} user=${userId} account deleted: subscriptionsCanceled=${subscriptionsCanceled} subscriptionsFailed=${subscriptionsFailed} analyses=${analysisIds.length} leftoverObjects=${leftoverObjects} conversationsFailed=${conversationsFailed} userRow=${userRowRemoved ? "removed" : "already gone"}`,
  );
  return {
    analyses: analysisIds.length,
    leftoverObjects,
    leftoverObjectsRemoved,
    conversationsFailed,
    subscriptionsCanceled,
    subscriptionsFailed,
    userRowRemoved,
  };
}

/** Platform deletes in flight at once: enough to make an account deletion quick, few enough to stay polite. */
export const PLATFORM_DELETE_CONCURRENCY = 4;

async function cleanUpConversations(ids: string[]): Promise<ConversationCleanup[]> {
  const unique = [...new Set(ids)];
  const out: ConversationCleanup[] = [];
  for (let at = 0; at < unique.length; at += PLATFORM_DELETE_CONCURRENCY) {
    const batch = unique.slice(at, at + PLATFORM_DELETE_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((id) => deleteConversation(id)));
    settled.forEach((result, i) => {
      const id = batch[i];
      if (result.status === "fulfilled") {
        out.push({ id, outcome: result.value });
        return;
      }
      console.error(
        `${LOG} conversation=${id} not deleted on the platform:`,
        result.reason instanceof Error ? result.reason.name : result.reason,
      );
      out.push({ id, outcome: "failed" });
    });
  }
  return out;
}

function describe(conversations: ConversationCleanup[]): string {
  const count = (outcome: ConversationCleanup["outcome"]) => conversations.filter((c) => c.outcome === outcome).length;
  return `deleted=${count("deleted")} notFound=${count("not-found")} failed=${count("failed")}`;
}
