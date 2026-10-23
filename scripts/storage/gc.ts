/**
 * The orphan collector for the CV bucket, by hand. Lists every object,
 * matches it against `ResumeAnalysis.resumeKey`, and reports what would
 * go: objects under `cv/` with no row and older than a day, and anything
 * outside `cv/`. Dry run by default; `--delete` removes the orphans and
 * lists what is left. In production the same collector runs as a Vercel
 * cron (app/api/cron/storage-gc, vercel.json).
 *
 *   npm run storage:gc              report only
 *   npm run storage:gc -- --delete  remove the orphans, then list again
 *
 * Never prints a key in full: the user id segment is shortened.
 */
import { parseArgs } from "node:util";
import prisma from "@/lib/prisma";
import { collectOrphans, describeObject, formatSize, abbreviateKey, ORPHAN_GRACE_HOURS } from "@/lib/supabase/gc";

const { values: args } = parseArgs({ options: { delete: { type: "boolean", default: false } } });

async function main() {
  const now = new Date();
  const report = await collectOrphans({ remove: args.delete, now });

  console.log(`rows referencing a key: ${report.referencedKeys}; objects in the bucket: ${report.objects}; grace: ${ORPHAN_GRACE_HOURS} h`);
  console.log(args.delete ? "before:" : "dry run:");
  if (report.classified.length === 0) console.log("  (empty)");
  for (const object of report.classified) console.log(`  ${describeObject(object, now)}`);
  console.log(`keep: ${report.classified.length - report.orphans.length}; orphans: ${report.orphans.length} (${formatSize(report.orphanBytes)})`);

  if (report.missing.length > 0) {
    console.log(`WARNING: ${report.missing.length} row(s) reference a key with no object:`);
    for (const key of report.missing) console.log(`  ${abbreviateKey(key)}`);
  }

  if (!args.delete) {
    if (report.orphans.length > 0) console.log("nothing deleted: run with --delete to remove the orphans");
    return;
  }

  console.log(`deleted ${report.deleted} object(s)`);
  console.log("after:");
  if (!report.after?.length) console.log("  (empty)");
  for (const object of report.after ?? []) console.log(`  ${describeObject(object, now)}`);
  console.log(`left: ${report.after?.length ?? 0}; still orphaned: ${report.after?.filter((object) => object.verdict.kind === "orphan").length ?? 0}`);
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
