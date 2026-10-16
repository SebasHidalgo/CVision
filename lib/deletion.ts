import "server-only";

import {
  collectDetachedConversationIds,
  deleteAnalysisRows,
  listAnalysisIdsOfUser,
} from "@/lib/database/deletion";
import { deleteUserRows } from "@/lib/database/user";
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
  userRowRemoved: boolean;
};

/**
 * Everything of one account, for `user.deleted`: each analysis through the
 * cascade above, the conversations of interviews that had no analysis, any
 * object left under `cv/{userId}/`, then the user row (whose foreign keys
 * take whatever is left). Idempotent: an account already gone yields zeros
 * and `userRowRemoved: false`.
 */
export async function deleteAccountCascade(userId: string): Promise<AccountDeletion> {
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
    `${LOG} user=${userId} account deleted: analyses=${analysisIds.length} leftoverObjects=${leftoverObjects} conversationsFailed=${conversationsFailed} userRow=${userRowRemoved ? "removed" : "already gone"}`,
  );
  return { analyses: analysisIds.length, leftoverObjects, leftoverObjectsRemoved, conversationsFailed, userRowRemoved };
}

async function cleanUpConversations(ids: string[]): Promise<ConversationCleanup[]> {
  const out: ConversationCleanup[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      out.push({ id, outcome: await deleteConversation(id) });
    } catch (error) {
      console.error(`${LOG} conversation=${id} not deleted on the platform:`, error instanceof Error ? error.name : error);
      out.push({ id, outcome: "failed" });
    }
  }
  return out;
}

function describe(conversations: ConversationCleanup[]): string {
  const count = (outcome: ConversationCleanup["outcome"]) => conversations.filter((c) => c.outcome === outcome).length;
  return `deleted=${count("deleted")} notFound=${count("not-found")} failed=${count("failed")}`;
}
