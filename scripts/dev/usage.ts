// Puts an account in a usage state without spending voice credits, to see each state of the interview room.
// Usage: npm run dev:usage -- --email <e> [--interviews-used <n>] [--trial-used] [--credits <n>] [--plan free|pro]
//        npm run dev:usage -- --email <e> --reset-trial   (the free trial again; interviews and feedback stay)
// Refuses unless ALLOW_DEV_TOOLS=1 and PADDLE_ENV=sandbox, and only against a Clerk development instance.
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { resolvePlanStanding } from "@/lib/database/billing";
import { devToolsAllowed } from "@/lib/devTools";
import { applyDevUsage, resetDevTrial, type DevUsageTarget } from "./usageState";

const { values: args } = parseArgs({
  options: {
    email: { type: "string" },
    "interviews-used": { type: "string" },
    "trial-used": { type: "boolean" },
    "reset-trial": { type: "boolean" },
    credits: { type: "string" },
    plan: { type: "string" },
  },
});

function count(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 50) throw new Error(`--${name} must be a whole number from 0 to 50`);
  return n;
}

async function userIdForEmail(email: string): Promise<string> {
  const key = process.env.CLERK_SECRET_KEY?.trim();
  if (!key?.startsWith("sk_test_")) throw new Error("CLERK_SECRET_KEY is not a development-instance key; dev:usage only runs against development");
  const response = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Clerk answered HTTP ${response.status} looking the account up`);
  const users = (await response.json()) as { id: string }[];
  if (users.length !== 1) throw new Error(`${users.length} Clerk accounts have that e-mail address`);
  return users[0].id;
}

async function main() {
  if (!devToolsAllowed()) throw new Error("refused: set ALLOW_DEV_TOOLS=1 and PADDLE_ENV=sandbox to use dev tools");
  if (!args.email) throw new Error("usage: npm run dev:usage -- --email <e> [--interviews-used <n>] [--trial-used] [--credits <n>] [--plan free|pro] | --reset-trial");
  if (args["reset-trial"] && (args["trial-used"] || args["interviews-used"] !== undefined || args.credits !== undefined)) {
    throw new Error("--reset-trial runs on its own (it may be combined with --plan free)");
  }
  const plan = args.plan?.toUpperCase();
  if (plan !== undefined && plan !== "FREE" && plan !== "PRO") throw new Error("--plan must be free or pro");
  const target: DevUsageTarget = {
    interviewsUsed: count("interviews-used", args["interviews-used"]),
    trialUsed: args["trial-used"] ? true : undefined,
    credits: count("credits", args.credits),
    plan,
  };

  const userId = await userIdForEmail(args.email);
  const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL });
  try {
    await db.user.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
    if (args["reset-trial"]) {
      if (plan) await db.user.update({ where: { id: userId }, data: { compPlan: plan === "PRO" ? "PRO" : null } });
      const reset = await resetDevTrial(db, userId, (id, now) => resolvePlanStanding(id, now));
      const next = reset.entitlement;
      console.log(`${userId}: ${reset.trialsReset} trial unit(s) given back, ${reset.interviewsReleased} unfinished interview(s) released; interviews and feedback kept`);
      console.log(`  next start: ${next.source === "none" ? `nothing (${next.reason})` : `${next.source}, ${next.maxDurationSeconds / 60} min`} on plan ${next.plan}`);
      for (const note of reset.notes) console.log(`  note: ${note}`);
      return;
    }
    const report = await applyDevUsage(db, userId, target, (id, now) => resolvePlanStanding(id, now));
    console.log(`${userId}: plan ${report.plan}, period ends ${report.periodEnd.toISOString()}`);
    console.log(`  interviews used this period ${report.interviewsUsed}, trial used ${report.trialUsed ? "yes" : "no"}, credits ${report.credits}`);
    for (const note of report.notes) console.log(`  note: ${note}`);
  } finally {
    await db.$disconnect();
  }
}

// The script smoke test loads this module to prove its imports resolve; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`dev:usage failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
