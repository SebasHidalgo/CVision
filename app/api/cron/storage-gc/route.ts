import { collectOrphans } from "@/lib/supabase/gc";
import { refuseUnlessCron } from "@/lib/cronAuth";

// Listing the bucket a folder at a time plus the deletes.
export const maxDuration = 60;

const LOG = "[CVision][cron] storage-gc:";

/**
 * The orphan collector as a Vercel cron (vercel.json). Public in the
 * middleware; the caller is authenticated by `CRON_SECRET`, which Vercel
 * sends as a bearer token on every cron invocation and nobody else holds.
 * Without the secret configured the route refuses everything, loudly: a
 * cron that silently does nothing is worse than one that fails.
 * Idempotent: an orphan deleted twice is deleted once, and a run that is
 * missed is caught up by the next. Answers counts only, never a key.
 */
export async function GET(request: Request) {
  const refusal = refuseUnlessCron(request, LOG);
  if (refusal) return refusal;

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
    };
    console.info(`${LOG} ${JSON.stringify(summary)}`);
    return Response.json({ ok: true, data: summary });
  } catch (error) {
    console.error(`${LOG} failed:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
    return Response.json({ ok: false, code: "UNKNOWN" }, { status: 500 });
  }
}
