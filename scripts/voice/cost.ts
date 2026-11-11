/**
 * What a voice minute really costs on the workspace's plan, from the
 * platform's own records of recent conversations: duration, credits charged
 * (agent minutes and LLM apart, when the platform splits them), credits per
 * minute, and what a 12-minute and a 5-minute interview cost in credits and
 * in dollars at the plan's price.
 *
 *   npm run voice:cost
 *   npm run voice:cost -- --since 2026-11-01
 *   npm run voice:cost -- --plan-usd 6
 *
 * Read-only. Needs conversations read and user read on the key. A deleted
 * conversation (its analysis or account was deleted) is gone from the
 * platform and is not counted. Never prints the key.
 */
import { parseArgs } from "node:util";
import { INTERVIEW_AGENT_IDS_FROM_ENV, listConversationIds, readConversationCost, readPlanPrice, summarizeCosts, type ConversationCost } from "@/lib/voice/admin";
import { INTERVIEW_TIERS } from "@/lib/plans";

const { values: args } = parseArgs({
  options: {
    since: { type: "string" },
    "plan-usd": { type: "string" },
    limit: { type: "string" },
  },
});

const DAY_MS = 24 * 60 * 60_000;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const usd = (value: number) => `USD ${value.toFixed(value < 1 ? 4 : 2)}`;

function line(cost: ConversationCost): string {
  const when = cost.startedAt ? cost.startedAt.toISOString().slice(0, 16).replace("T", " ") : "(no start)";
  if (cost.credits === null) return `  ${when}  ${cost.conversationId.slice(-8)}  ${cost.status.padEnd(6)} not charged${cost.failure ? `: ${cost.failure}` : ""}`;
  const perMinute = cost.durationSeconds > 0 ? Math.round((cost.credits / cost.durationSeconds) * 60) : 0;
  const split = cost.callCredits !== null || cost.llmCredits !== null ? ` (call ${cost.callCredits ?? "?"} + llm ${cost.llmCredits ?? "?"})` : "";
  const extras = [
    cost.tier ?? "",
    cost.burst ? "burst rate" : "",
    cost.queueSeconds && cost.queueSeconds >= 1 ? `waited ${Math.round(cost.queueSeconds)} s in line` : "",
    cost.voiceSurchargeCredits ? `voice surcharge ${cost.voiceSurchargeCredits}` : "",
    cost.language ?? "",
  ].filter(Boolean);
  return `  ${when}  ${cost.conversationId.slice(-8)}  ${clock(cost.durationSeconds).padStart(5)}  ${String(cost.credits).padStart(6)} credits${split}  ${perMinute}/min${extras.length ? `  [${extras.join(", ")}]` : ""}`;
}

async function main() {
  const since = args.since ? new Date(args.since) : new Date(Date.now() - 7 * DAY_MS);
  if (Number.isNaN(since.getTime())) throw new Error("--since must be a date, e.g. 2026-11-01");
  const limit = args.limit ? Number(args.limit) : 100;

  const agentIds = INTERVIEW_AGENT_IDS_FROM_ENV();
  if (agentIds.length === 0) throw new Error("ELEVENLABS_AGENT_ID and ELEVENLABS_TRIAL_AGENT_ID are not set (see .env.template)");

  const plan = await readPlanPrice();
  const planUsd = args["plan-usd"] ? Number(args["plan-usd"]) : plan.dollars;
  const perCredit = planUsd !== null && plan.credits > 0 ? planUsd / plan.credits : null;
  console.log(`Plan: ${plan.tier}, ${plan.credits} credits a period${planUsd !== null ? ` for ${usd(planUsd)}${args["plan-usd"] ? " (given)" : " (the next invoice)"}` : ", price unknown (pass --plan-usd)"}; ${plan.creditsUsed} used so far.`);

  const ids = await listConversationIds({ agentIds, since, limit });
  console.log(`\nConversations since ${since.toISOString().slice(0, 10)} (${ids.length}):`);
  const costs: ConversationCost[] = [];
  for (const id of ids) {
    const cost = await readConversationCost(id);
    costs.push(cost);
    console.log(line(cost));
  }

  // Rates differ by plan: only the calls charged on the current plan say what a minute costs now.
  const otherPlans = [...new Set(costs.map((cost) => cost.tier).filter((tier): tier is string => tier !== null && tier !== plan.tier))];
  for (const tier of otherPlans) {
    const other = summarizeCosts(costs.filter((cost) => cost.tier === tier));
    if (other.creditsPerMinute !== null) {
      console.log(`\nOn the ${tier} plan (not the current one): ${other.charged} call(s), ${clock(other.seconds)}, ${Math.round(other.creditsPerMinute)} credits a minute (call ${Math.round((other.callCredits / other.seconds) * 60)} + llm ${Math.round((other.llmCredits / other.seconds) * 60)}).`);
    }
  }
  const summary = summarizeCosts(costs.filter((cost) => cost.tier === null || cost.tier === plan.tier));
  if (summary.creditsPerMinute === null) {
    console.log(`\nNo charged call on the ${plan.tier} plan in the range: nothing to measure.`);
    return;
  }
  const perMinute = summary.creditsPerMinute;
  console.log(`\nOn the ${plan.tier} plan: ${summary.charged} charged call(s), ${clock(summary.seconds)} in total, ${Math.round(summary.credits)} credits (call ${Math.round(summary.callCredits)} + llm ${Math.round(summary.llmCredits)}).`);
  console.log(`A minute costs ${Math.round(perMinute)} credits (call ${Math.round((summary.callCredits / summary.seconds) * 60)} + llm ${Math.round((summary.llmCredits / summary.seconds) * 60)})${perCredit !== null ? `, ${usd(perMinute * perCredit)} at the plan's price` : ""}.`);
  for (const tier of ["FULL", "TRIAL"] as const) {
    const minutes = INTERVIEW_TIERS[tier].seconds / 60;
    const credits = perMinute * minutes;
    console.log(`A ${minutes}-minute interview: ${Math.round(credits)} credits${perCredit !== null ? `, ${usd(credits * perCredit)}` : ""}${plan.credits > 0 ? `; the plan holds ${Math.floor(plan.credits / credits)} of them` : ""}.`);
  }
  if (summary.seconds < 300) {
    console.log("\nUnder five minutes of calls on this plan: short calls are mostly greeting, so the LLM share is understated. Run it again after a full interview.");
  }
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`voice:cost failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
