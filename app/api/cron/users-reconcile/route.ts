import { reconcileUsers, type ReconcileReport } from "@/lib/accountReconcile";

// The Clerk lookups plus up to 25 account deletions (Paddle, the bucket and ElevenLabs each).
export const maxDuration = 60;

// No deletion starts after this much of the budget; the rest waits for tomorrow's run.
const DELETION_BUDGET_MS = 40_000;

const LOG = "[CVision][cron] users-reconcile:";

const counts = (report: ReconcileReport) => ({
  checked: report.checked,
  skippedRecent: report.skippedRecent,
  candidates: report.candidates,
  listMismatches: report.listMismatches,
  limit: report.limit,
  gone: report.gone.length,
  deleted: report.deleted.length,
  deferred: report.deferred.length,
  failed: report.failed ? 1 : 0,
});

/**
 * The account reconcile (lib/accountReconcile.ts) as a daily Vercel cron
 * (vercel.json), applying: an account deleted in Clerk whose webhook was
 * lost goes the way the webhook would have taken it. Public in the proxy
 * as this exact path; the caller is authenticated by `CRON_SECRET`, like
 * the storage collector's. The run keeps every guard of the script and has
 * no override: a refusal answers 500 and logs loudly, for a human to look.
 * Answers counts only; the ids are in the per-deletion log lines.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error(`${LOG} CRON_SECRET is not set; refusing`);
    return Response.json({ ok: false, code: "CRON_MISCONFIGURED" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const report = await reconcileUsers({ apply: true, deadline: Date.now() + DELETION_BUDGET_MS });
    const summary = { outcome: report.outcome, ...counts(report) };
    if (report.outcome === "refused") {
      console.error(`${LOG} REFUSED by the blast-radius guard, nothing deleted: ${JSON.stringify(summary)}`);
      return Response.json({ ok: false, code: "RECONCILE_REFUSED", data: summary }, { status: 500 });
    }
    if (report.failed) {
      console.error(`${LOG} stopped on a failed deletion: ${JSON.stringify(summary)}`);
      return Response.json({ ok: false, code: "RECONCILE_FAILED", data: summary }, { status: 500 });
    }
    console.info(`${LOG} ${JSON.stringify(summary)}`);
    return Response.json({ ok: true, data: summary });
  } catch (error) {
    // A Clerk lookup that was not certain, or the database: nothing was deleted.
    console.error(`${LOG} failed before deleting anything:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
    return Response.json({ ok: false, code: "RECONCILE_FAILED" }, { status: 500 });
  }
}
