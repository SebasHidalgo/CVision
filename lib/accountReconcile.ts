import "server-only";

import { CLERK_LOOKUP_BATCH, clerkUserLookup, type ClerkUserLookup } from "@/lib/clerk/users";
import { countUsersCreatedSince, listUsersCreatedBefore, type UserListing } from "@/lib/database/userById";
import { deleteAccountCascade, type AccountDeletion } from "@/lib/deletion";

/**
 * The net under Clerk's `user.deleted` webhook: an account deleted in Clerk
 * whose delivery was lost would keep its CV, its analyses and its
 * conversation ids forever. This finds the local `User` rows Clerk no
 * longer has and runs the same `deleteAccountCascade` the webhook runs.
 * Used by `npm run users:reconcile` (a dry run unless `--apply`) and by the
 * daily cron (app/api/cron/users-reconcile).
 *
 * Built to fail closed, in phases: every lookup happens before any delete,
 * so a Clerk error at any point deletes nothing. The batch list only finds
 * candidates; each is then confirmed with its own `GET /users/{id}` 404.
 * The blast-radius guard refuses a run that would take more than a small
 * share of the accounts (a key from another Clerk instance makes everyone
 * look gone). Accounts younger than a day are left alone: their webhook
 * may still be on its way, and Clerk's list may not show them yet.
 */

const LOG = "[CVision][reconcile-users]";

/** Accounts this young are never looked up. */
export const RECENT_ACCOUNT_HOURS = 24;
/** Without an explicit ceiling a run deletes at most this share of the accounts it checked… */
export const BLAST_RADIUS_MAX_SHARE = 0.2;
/** …and never more than this many, however large the table. */
export const BLAST_RADIUS_MAX_COUNT = 25;

export function blastRadiusLimit(checked: number): number {
  return Math.min(BLAST_RADIUS_MAX_COUNT, Math.floor(checked * BLAST_RADIUS_MAX_SHARE));
}

export type ReconcileDependencies = {
  listUsers: (page: { createdBefore: Date; afterId: string | null; take: number }) => Promise<UserListing[]>;
  countRecent: (since: Date) => Promise<number>;
  lookup: ClerkUserLookup;
  deleteAccount: (userId: string) => Promise<AccountDeletion>;
  now: () => number;
};

export type ReconcileOptions = {
  /** False: report only. */
  apply: boolean;
  /** An explicit ceiling chosen by an operator after a dry run; replaces the share-and-count limit. */
  maxDelete?: number;
  /** Epoch ms after which no new deletion starts (a cron's time budget); the rest waits for the next run. */
  deadline?: number;
};

export type ReconcileReport = {
  mode: "dry-run" | "apply";
  /** Accounts older than a day, looked up at Clerk. */
  checked: number;
  /** Accounts younger than a day, not looked up. */
  skippedRecent: number;
  /** Missing from Clerk's list. */
  candidates: number;
  /** Missing from the list but found by id: the list was wrong about them; kept. */
  listMismatches: number;
  /** The most this run may delete, and whether an operator set it. */
  limit: number;
  limitSource: "default" | "operator";
  /**
   * nothing: no account is gone. refused: more candidates than the limit,
   * nothing confirmed or deleted. ready: the dry run's verdict. done: every
   * gone account deleted. partial: the deadline or a failed deletion
   * stopped the run; what is left goes next time.
   */
  outcome: "nothing" | "refused" | "ready" | "done" | "partial";
  /** Confirmed gone at Clerk (404 on the id), with the local creation date. */
  gone: UserListing[];
  deleted: string[];
  /** Not started because the deadline passed. */
  deferred: string[];
  /** The deletion that threw, which stopped the run. */
  failed: string | null;
};

export async function reconcileUsers(options: ReconcileOptions, deps: ReconcileDependencies = defaultDependencies()): Promise<ReconcileReport> {
  const cutoff = new Date(deps.now() - RECENT_ACCOUNT_HOURS * 3_600_000);
  const report: ReconcileReport = {
    mode: options.apply ? "apply" : "dry-run",
    checked: 0,
    skippedRecent: await deps.countRecent(cutoff),
    candidates: 0,
    listMismatches: 0,
    limit: 0,
    limitSource: options.maxDelete === undefined ? "default" : "operator",
    outcome: "nothing",
    gone: [],
    deleted: [],
    deferred: [],
    failed: null,
  };

  // Phase 1: the whole table against Clerk's list, a batch at a time. Reads only.
  const candidates: UserListing[] = [];
  for (let afterId: string | null = null; ; ) {
    const page = await deps.listUsers({ createdBefore: cutoff, afterId, take: CLERK_LOOKUP_BATCH });
    if (page.length === 0) break;
    const existing = await deps.lookup.listExisting(page.map((user) => user.id));
    candidates.push(...page.filter((user) => !existing.has(user.id)));
    report.checked += page.length;
    if (page.length < CLERK_LOOKUP_BATCH) break;
    afterId = page[page.length - 1].id;
  }
  report.candidates = candidates.length;
  report.limit = options.maxDelete ?? blastRadiusLimit(report.checked);
  if (candidates.length === 0) return report;

  // Phase 2: the guard, before a single id is confirmed or deleted.
  if (candidates.length > report.limit) {
    report.outcome = "refused";
    console.error(
      `${LOG} REFUSED: ${candidates.length} of ${report.checked} accounts look deleted at Clerk, over the limit of ${report.limit} (${report.limitSource}). Nothing was deleted. Check CLERK_SECRET_KEY is this deployment's instance; if the number is right, run it by hand with --max-delete ${candidates.length}.`,
    );
    return report;
  }

  // Phase 3: each candidate confirmed by its own id. Reads only; any doubt throws before a delete.
  for (const user of candidates) {
    if (await deps.lookup.isGone(user.id)) report.gone.push(user);
    else report.listMismatches += 1;
  }
  if (report.listMismatches > 0) {
    console.warn(`${LOG} ${report.listMismatches} account(s) missing from Clerk's list exist by id; kept`);
  }
  if (report.gone.length === 0) return report;
  if (!options.apply) {
    report.outcome = "ready";
    return report;
  }

  // Phase 4: the deletions, one account at a time, stopping at the deadline or the first failure.
  for (const [index, user] of report.gone.entries()) {
    if (options.deadline !== undefined && deps.now() >= options.deadline) {
      report.deferred = report.gone.slice(index).map((u) => u.id);
      break;
    }
    try {
      const summary = await deps.deleteAccount(user.id);
      report.deleted.push(user.id);
      console.info(
        `${LOG} deleted user=${user.id} analyses=${summary.analyses} objects=${summary.objectsRemoved} conversations=${summary.conversationsDeleted} conversationsFailed=${summary.conversationsFailed} subscriptionsCanceled=${summary.subscriptionsCanceled} subscriptionsFailed=${summary.subscriptionsFailed} userRow=${summary.userRowRemoved ? "removed" : "already gone"}`,
      );
    } catch (error) {
      report.failed = user.id;
      console.error(`${LOG} user=${user.id} deletion failed; the run stops here:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
      break;
    }
  }
  report.outcome = report.deleted.length === report.gone.length ? "done" : "partial";
  return report;
}

function defaultDependencies(): ReconcileDependencies {
  return {
    listUsers: listUsersCreatedBefore,
    countRecent: countUsersCreatedSince,
    lookup: clerkUserLookup({ secretKey: process.env.CLERK_SECRET_KEY ?? "" }),
    deleteAccount: deleteAccountCascade,
    now: Date.now,
  };
}
