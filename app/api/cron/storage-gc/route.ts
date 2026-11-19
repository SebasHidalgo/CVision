import { sweepUnstartedRooms } from "@/lib/database/unstartedRooms";
import { refundAbandonedAnalyses, type AbandonedAnalysesReport } from "@/lib/database/usage";
import { collectOrphans } from "@/lib/supabase/gc";
import { refuseUnlessCron } from "@/lib/cronAuth";

// Listing the bucket a folder at a time plus the deletes; the ledger sweep is three queries, the rooms' one.
export const maxDuration = 60;

const LOG = "[CVision][cron] storage-gc:";

const errorLine = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : error);

/**
 * What a killed analysis request leaves behind, as a Vercel cron (vercel.json): its analysis unit, still held, and
 * its CV, with no row. First the ledger (the held units older than an hour with no analysis row are given back), then
 * the orphan collector. Also the interview rooms that never started, older than three days (one guarded delete,
 * lib/database/unstartedRooms.ts). Public in the middleware; the caller is authenticated by `CRON_SECRET`, which
 * Vercel sends as a bearer token on every cron invocation and nobody else holds. Without the secret configured the route refuses
 * everything, loudly: a cron that silently does nothing is worse than one that fails. Each step runs even when
 * another fails, and any failing answers 500. Idempotent: a unit is given back once and an orphan deleted once,
 * and a missed run is caught up by the next. Answers counts only, never a key or an id.
 */
export async function GET(request: Request) {
  const refusal = refuseUnlessCron(request, LOG);
  if (refusal) return refusal;

  let failed = false;
  let units: AbandonedAnalysesReport | null = null;
  try {
    units = await refundAbandonedAnalyses();
  } catch (error) {
    failed = true;
    console.error(`${LOG} abandoned analysis units failed:`, errorLine(error));
  }

  let unstartedRooms: number | null = null;
  try {
    unstartedRooms = (await sweepUnstartedRooms({ remove: true })).rooms;
  } catch (error) {
    failed = true;
    console.error(`${LOG} unstarted interview rooms failed:`, errorLine(error));
  }

  try {
    const report = await collectOrphans({ remove: true });
    const summary = {
      referencedKeys: report.referencedKeys,
      objects: report.objects,
      orphans: report.orphans.length,
      orphanBytes: report.orphanBytes,
      deleted: report.deleted,
      missing: report.missing.length,
      left: report.after?.length ?? null,
      abandonedUnits: units,
      unstartedRooms,
    };
    console.info(`${LOG} ${JSON.stringify(summary)}`);
    if (failed) return Response.json({ ok: false, code: "UNKNOWN" }, { status: 500 });
    return Response.json({ ok: true, data: summary });
  } catch (error) {
    console.error(`${LOG} failed:`, errorLine(error));
    return Response.json({ ok: false, code: "UNKNOWN" }, { status: 500 });
  }
}
