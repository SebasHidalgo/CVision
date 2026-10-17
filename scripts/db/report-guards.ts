/**
 * What the two guardrails did over a date range, from the stats stored
 * beside each analysis (`ResumeAnalysis.guardStats`) and each interview
 * feedback (`InterviewFeedback.guardStats`): rows seen, rows where something
 * fired, and the counts per action and per check. Counts only: an
 * intervention's value is CV or transcript text and is never printed.
 *
 *   npm run report:guards                                   the last 30 days
 *   npm run report:guards -- --from 2026-10-01 --to 2026-11-01   [from, to), UTC
 *
 * Rows from before the stats were recorded show as "not recorded". Runs
 * over DIRECT_URL (DATABASE_URL when unset); prints no connection string.
 */
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { guardStatsSchema, type GuardStats } from "@/lib/ai/schemas";

const { values: args } = parseArgs({
  options: { from: { type: "string" }, to: { type: "string" } },
});

const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required");
const prisma = new PrismaClient({ datasourceUrl: url });

const DEFAULT_WINDOW_DAYS = 30;

type Tally = {
  rows: number;
  notRecorded: number;
  malformed: number;
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

function tally(rows: Array<{ guardStats: unknown }>): Tally {
  const out: Tally = { rows: rows.length, notRecorded: 0, malformed: 0, fired: 0, byAction: new Map(), byCheckAndAction: new Map() };
  for (const row of rows) {
    if (row.guardStats === null || row.guardStats === undefined) {
      out.notRecorded += 1;
      continue;
    }
    const parsed = guardStatsSchema.safeParse(row.guardStats);
    if (!parsed.success) {
      out.malformed += 1;
      continue;
    }
    const stats: GuardStats = parsed.data;
    let any = false;
    for (const [action, count] of Object.entries(stats.counts)) {
      if (count > 0) any = true;
      out.byAction.set(action, (out.byAction.get(action) ?? 0) + count);
    }
    for (const intervention of stats.interventions) {
      const key = `${intervention.check} -> ${intervention.action}`;
      out.byCheckAndAction.set(key, (out.byCheckAndAction.get(key) ?? 0) + 1);
    }
    if (any) out.fired += 1;
  }
  return out;
}

function print(title: string, t: Tally) {
  const recorded = t.rows - t.notRecorded - t.malformed;
  console.log(`\n${title}`);
  console.log(`  rows in range          ${t.rows}`);
  console.log(`  with stats recorded    ${recorded}${t.notRecorded ? `   (${t.notRecorded} not recorded: before M1b)` : ""}${t.malformed ? `   (${t.malformed} malformed)` : ""}`);
  console.log(`  rows where it fired    ${t.fired}${recorded ? ` of ${recorded} (${Math.round((100 * t.fired) / recorded)}%)` : ""}`);
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
  console.log(`Guardrail report, ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)} (UTC, end exclusive)`);

  const analyses = await prisma.resumeAnalysis.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { guardStats: true },
  });
  // InterviewFeedback has no timestamp of its own; its interview's creation
  // dates it closely enough (feedback follows the call by minutes).
  const feedbacks = await prisma.interviewFeedback.findMany({
    where: { interview: { createdAt: { gte: from, lt: to } } },
    select: { guardStats: true },
  });

  print("Resume analyses (lib/ai/analysisGuardrails.ts)", tally(analyses));
  print("Interview feedback (lib/ai/interviewGuardrails.ts)", tally(feedbacks));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
