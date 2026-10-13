/**
 * The orphan collector for the CV bucket. Lists every object, matches it
 * against `ResumeAnalysis.resumeKey`, and reports what would go: objects
 * under `cv/` with no row and older than a day, and anything outside `cv/`.
 * Dry run by default; `--delete` removes the orphans and lists what is left.
 *
 *   npm run storage:gc              report only
 *   npm run storage:gc -- --delete  remove the orphans, then list again
 *
 * Run by hand until deploy, then as a Vercel cron. Never prints a key in
 * full: the user id segment is shortened.
 */
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { listObjects, removeObjects, type StoredObject } from "@/lib/supabase/server";
import { classifyObjects, missingObjects, ORPHAN_GRACE_HOURS, type Classified } from "./gcClassify";

const { values: args } = parseArgs({ options: { delete: { type: "boolean", default: false } } });
const prisma = new PrismaClient();

const DELETE_BATCH = 100;

async function main() {
  const rows = await prisma.resumeAnalysis.findMany({ select: { resumeKey: true } });
  const referenced = new Set(rows.map((row) => row.resumeKey));
  const now = new Date();

  const objects = await listObjects();
  const classified = classifyObjects(objects, referenced, now);
  const orphans = classified.filter((object) => object.verdict.kind === "orphan");
  const kept = classified.length - orphans.length;

  console.log(`rows referencing a key: ${referenced.size}; objects in the bucket: ${objects.length}; grace: ${ORPHAN_GRACE_HOURS} h`);
  console.log(args.delete ? "before:" : "dry run:");
  printTable(classified, now);
  console.log(`keep: ${kept}; orphans: ${orphans.length} (${formatSize(orphans.reduce((sum, o) => sum + (o.size ?? 0), 0))})`);

  const missing = missingObjects(objects, referenced);
  if (missing.length > 0) {
    console.log(`WARNING: ${missing.length} row(s) reference a key with no object:`);
    for (const key of missing) console.log(`  ${abbreviate(key)}`);
  }

  if (!args.delete) {
    if (orphans.length > 0) console.log("nothing deleted: run with --delete to remove the orphans");
    return;
  }

  for (let at = 0; at < orphans.length; at += DELETE_BATCH) {
    const batch = orphans.slice(at, at + DELETE_BATCH).map((object) => object.key);
    await removeObjects(batch);
    console.log(`deleted ${batch.length} object(s)`);
  }

  const after = classifyObjects(await listObjects(), referenced, new Date());
  console.log("after:");
  printTable(after, now);
  console.log(`left: ${after.length}; still orphaned: ${after.filter((o) => o.verdict.kind === "orphan").length}`);
}

function printTable(objects: Classified[], now: Date) {
  if (objects.length === 0) {
    console.log("  (empty)");
    return;
  }
  for (const object of objects) {
    const age = object.createdAt ? `${Math.floor((now.getTime() - object.createdAt.getTime()) / 3_600_000)} h` : "age unknown";
    const verdict = `${object.verdict.kind}:${object.verdict.why}`;
    console.log(`  ${verdict.padEnd(18)} ${formatSize(object.size).padStart(9)}  ${age.padStart(8)}  ${abbreviate(object.key)}`);
  }
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "?";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** The user id segment is the owner's; shorten it so the log is readable. */
function abbreviate(key: string): string {
  return key.replace(/^cv\/([^/]{8})[^/]*\//, "cv/$1…/");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
