/**
 * The sweep of interview rooms that never started, by hand: rooms opened from an analysis and never given a voice
 * session, older than three days. Dry run by default; `--delete` deletes them. In production the same sweep runs in
 * the daily Vercel cron (app/api/cron/storage-gc); locally nothing runs it but this.
 *
 *   npm run interviews:gc              count only
 *   npm run interviews:gc -- --delete  delete them
 *
 * Prints counts only, never an id.
 */
import { parseArgs } from "node:util";
import { sweepUnstartedRooms, UNSTARTED_ROOM_TTL_MS } from "@/lib/database/unstartedRooms";

const { values: args } = parseArgs({ options: { delete: { type: "boolean", default: false } }, strict: true });

async function main() {
  const report = await sweepUnstartedRooms({ remove: args.delete });
  const age = `${UNSTARTED_ROOM_TTL_MS / 86_400_000} days (created before ${report.cutoff.toISOString()})`;
  if (report.deleted) {
    console.log(`deleted ${report.rooms} room(s) never started and older than ${age}`);
    return;
  }
  console.log(`dry run: ${report.rooms} room(s) never started and older than ${age}`);
  if (report.rooms > 0) console.log("nothing deleted: run with --delete to delete them");
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main()
    .catch((error: unknown) => {
      console.error(`interviews:gc failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { default: prisma } = await import("@/lib/prisma");
      await prisma.$disconnect();
    });
}
