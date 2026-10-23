import "server-only";

import prisma from "@/lib/prisma";
import { listObjects, removeObjects, type StoredObject } from "@/lib/supabase/server";
import { classifyObjects, missingObjects, ORPHAN_GRACE_HOURS, type Classified } from "./gcClassify";

/**
 * The orphan collector: every object in the CV bucket against every
 * `ResumeAnalysis.resumeKey`. Objects under `cv/` with no row and older
 * than a day, and anything outside `cv/`, are orphans; folder placeholders
 * and anything referenced or recent are kept. The script (`storage:gc`)
 * and the cron route run this; the decision lives in gcClassify.ts.
 */

export type CollectorReport = {
  referencedKeys: number;
  objects: number;
  classified: Classified[];
  orphans: Classified[];
  orphanBytes: number;
  /** Keys a row references that are not in the bucket: the other kind of orphan, reported, never acted on. */
  missing: string[];
  deleted: number;
  /** After a delete, what the bucket still holds. */
  after: Classified[] | null;
};

const DELETE_BATCH = 100;

export async function collectOrphans({ remove, now = new Date() }: { remove: boolean; now?: Date }): Promise<CollectorReport> {
  const rows = await prisma.resumeAnalysis.findMany({ select: { resumeKey: true } });
  const referenced = new Set(rows.map((row) => row.resumeKey));

  const objects = await listObjects();
  const classified = classifyObjects(objects, referenced, now);
  const orphans = classified.filter((object) => object.verdict.kind === "orphan");
  const report: CollectorReport = {
    referencedKeys: referenced.size,
    objects: objects.length,
    classified,
    orphans,
    orphanBytes: orphans.reduce((sum, object) => sum + (object.size ?? 0), 0),
    missing: missingObjects(objects, referenced),
    deleted: 0,
    after: null,
  };
  if (!remove) return report;

  for (let at = 0; at < orphans.length; at += DELETE_BATCH) {
    const batch = orphans.slice(at, at + DELETE_BATCH).map((object) => object.key);
    await removeObjects(batch);
    report.deleted += batch.length;
  }
  report.after = classifyObjects(await listObjects(), referenced, new Date());
  return report;
}

/** One line per object for a log, the user id segment shortened. */
export function describeObject(object: StoredObject & { verdict: Classified["verdict"] }, now: Date): string {
  const age = object.createdAt ? `${Math.floor((now.getTime() - object.createdAt.getTime()) / 3_600_000)} h` : "age unknown";
  const verdict = `${object.verdict.kind}:${object.verdict.why}`;
  return `${verdict.padEnd(18)} ${formatSize(object.size).padStart(9)}  ${age.padStart(8)}  ${abbreviateKey(object.key)}`;
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return "?";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** The user id segment is the owner's; shorten it so a log line is readable and names nobody. */
export function abbreviateKey(key: string): string {
  return key.replace(/^cv\/([^/]{8})[^/]*\//, "cv/$1…/");
}

export { ORPHAN_GRACE_HOURS };
