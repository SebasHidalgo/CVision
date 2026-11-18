/**
 * The net under Clerk's `user.deleted` webhook, by hand: finds the local
 * accounts Clerk no longer has (older than a day) and deletes each the way
 * the webhook would have (lib/accountReconcile.ts). In production the same
 * run applies daily as a Vercel cron (app/api/cron/users-reconcile).
 *
 *   npm run users:reconcile                          dry run: what would go
 *   npm run users:reconcile -- --apply               delete them
 *   npm run users:reconcile -- --max-delete 17       raise the guard's ceiling to 17 for this run
 *
 * Refuses (exit 2) when more accounts look gone than the blast-radius limit
 * allows (a fifth of those checked, at most 25): read the dry run, then pass
 * the number you expect with --max-delete. Any doubt from Clerk stops the
 * run before a single delete (exit 1). Prints Clerk ids, never anything else
 * about a person.
 */
import { parseArgs } from "node:util";
import {
  BLAST_RADIUS_MAX_COUNT,
  BLAST_RADIUS_MAX_SHARE,
  RECENT_ACCOUNT_HOURS,
  reconcileUsers,
} from "@/lib/accountReconcile";

function readOptions() {
  const { values } = parseArgs({
    options: { apply: { type: "boolean", default: false }, "max-delete": { type: "string" } },
    strict: true,
  });
  const raw = values["max-delete"];
  if (raw !== undefined && !/^\d+$/.test(raw)) throw new Error(`--max-delete takes a whole number, got "${raw}"`);
  return { apply: values.apply, maxDelete: raw === undefined ? undefined : Number(raw) };
}

async function main() {
  const options = readOptions();
  const report = await reconcileUsers(options);

  console.log(`${report.mode}: checked ${report.checked} account(s) older than ${RECENT_ACCOUNT_HOURS} h; skipped ${report.skippedRecent} younger`);
  console.log(
    `missing from Clerk's list: ${report.candidates}; limit ${report.limit} (${report.limitSource === "operator" ? "--max-delete" : `${BLAST_RADIUS_MAX_SHARE * 100} % of checked, at most ${BLAST_RADIUS_MAX_COUNT}`})`,
  );
  if (report.outcome === "refused") {
    console.log("REFUSED: nothing confirmed, nothing deleted.");
    process.exitCode = 2;
    return;
  }
  if (report.listMismatches > 0) console.log(`found by id after all (kept): ${report.listMismatches}`);
  console.log(`gone at Clerk (404 by id): ${report.gone.length}`);
  for (const user of report.gone) {
    const verb = report.deleted.includes(user.id) ? "deleted" : report.mode === "apply" ? "left" : "would delete";
    console.log(`  ${verb} ${user.id} (row created ${user.createdAt.toISOString().slice(0, 10)})`);
  }
  if (report.outcome === "ready") console.log("nothing deleted: run with --apply to delete them");
  if (report.failed) {
    console.log(`stopped: the deletion of ${report.failed} failed; the rest waits for the next run`);
    process.exitCode = 1;
  }
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main()
    .catch((error: unknown) => {
      console.error(`users:reconcile failed, nothing deleted: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { default: prisma } = await import("@/lib/prisma");
      await prisma.$disconnect();
    });
}
