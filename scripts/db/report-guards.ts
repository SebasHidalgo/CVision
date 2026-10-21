/**
 * What the two guardrails did over a date range, from the anonymous daily
 * aggregate (`GuardStatDaily`): rows that stored stats, rows where
 * something fired, and the counts per action and per check. The aggregate
 * is incremented in the same transaction that stores a row's `guardStats`
 * and is never deleted, so the signal survives the deletion of the rows and
 * accounts it came from. Counts only, by construction: it holds no user,
 * no id and no text.
 *
 *   npm run report:guards                                   the last 30 days
 *   npm run report:guards -- --from 2026-10-01 --to 2026-11-01   [from, to), UTC days
 *
 * An analysis is dated by its creation, an interview feedback by
 * `InterviewFeedback.createdAt` (the day the feedback was stored). Rows from
 * before the aggregate existed were folded into it once by its migration.
 * Runs over DIRECT_URL (DATABASE_URL when unset); prints no connection string.
 */
import { parseArgs } from "node:util";
import { PrismaClient, type GuardKind } from "@prisma/client";
import { GUARD_ROWS } from "@/lib/ai/schemas";

const { values: args } = parseArgs({
  options: { from: { type: "string" }, to: { type: "string" } },
});

const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required");
const prisma = new PrismaClient({ datasourceUrl: url });

const DEFAULT_WINDOW_DAYS = 30;

type Tally = {
  recorded: number;
  fired: number;
  byAction: Map<string, number>;
  byCheckAndAction: Map<string, number>;
};

function parseDay(value: string | undefined, fallback: Date, flag: string): Date {
  if (value === undefined) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--${flag} must be YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`--${flag} is not a date`);
  return date;
}

function tally(rows: Array<{ check: string; action: string; count: number }>): Tally {
  const out: Tally = { recorded: 0, fired: 0, byAction: new Map(), byCheckAndAction: new Map() };
  for (const row of rows) {
    if (row.check === GUARD_ROWS.check) {
      if (row.action === GUARD_ROWS.recorded) out.recorded += row.count;
      if (row.action === GUARD_ROWS.fired) out.fired += row.count;
      continue;
    }
    out.byAction.set(row.action, (out.byAction.get(row.action) ?? 0) + row.count);
    const key = `${row.check} -> ${row.action}`;
    out.byCheckAndAction.set(key, (out.byCheckAndAction.get(key) ?? 0) + row.count);
  }
  return out;
}

function print(title: string, t: Tally) {
  console.log(`\n${title}`);
  console.log(`  rows with stats        ${t.recorded}`);
  console.log(`  rows where it fired    ${t.fired}${t.recorded ? ` of ${t.recorded} (${Math.round((100 * t.fired) / t.recorded)}%)` : ""}`);
  const actions = [...t.byAction.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  per action             ${actions.length ? actions.map(([a, n]) => `${a} ${n}`).join(", ") : "nothing recorded"}`);
  const pairs = [...t.byCheckAndAction.entries()].sort((a, b) => b[1] - a[1]);
  if (pairs.length) {
    console.log("  per check");
    for (const [key, n] of pairs) console.log(`    ${key.padEnd(42)} ${n}`);
  }
}

async function main() {
  const to = parseDay(args.to, new Date(), "to");
  const from = parseDay(args.from, new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000), "from");
  if (from >= to) throw new Error("--from must be before --to");
  console.log(`Guardrail report, ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)} (UTC days, end exclusive)`);

  const rows = await prisma.guardStatDaily.findMany({
    where: { date: { gte: from, lt: to } },
    select: { kind: true, check: true, action: true, count: true },
  });
  const ofKind = (kind: GuardKind) => rows.filter((row) => row.kind === kind);

  print("Resume analyses (lib/ai/analysisGuardrails.ts)", tally(ofKind("ANALYSIS")));
  print("Interview feedback (lib/ai/interviewGuardrails.ts)", tally(ofKind("INTERVIEW")));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
