import { INTERVIEW_TIERS, PLANS, type InterviewTierId, type PlanId } from "@/lib/plans";

/**
 * Which interview the next start would get, decided in one place from the
 * rules the owner set: a Pro takes one of the period's interviews, then a
 * pack credit; a Free account takes a credit if it holds any (a full
 * interview on the main agent), else its lifetime trial if it never had
 * voice (the trial agent), else nothing. Pure, so the ledger runs it inside
 * its reservation transaction and every page runs the same function on the
 * same facts: the CTA, the room's label and countdown, the create action's
 * pre-check and the session endpoint cannot disagree, which is how the
 * room once promised five minutes for a credit the endpoint ran for twelve.
 * Import-free beyond the plans, so client components can read it.
 */

export type EntitlementSource = "period" | "credit" | "trial" | "none";
export type EntitlementAgent = "main" | "trial";

/** Why the source is what it is; the copy is chosen from this. */
export type EntitlementReason =
  /** One of the period's interviews is left. */
  | "period-left"
  /** A pack credit pays for it (after the period's, for a Pro). */
  | "credit"
  /** The lifetime trial is still available. */
  | "trial-available"
  /** A Pro with the period's interviews used and no credits: back at the period's end. */
  | "period-used"
  /** A Free account whose trial is used, with no credits. */
  | "trial-used"
  /** A Free account that never tried but had voice (a subscription once, or a full interview): no trial. */
  | "had-voice";

export type EntitlementRemaining = {
  /** The period's interviews left (0 for Free). */
  period: number;
  periodLimit: number;
  credits: number;
  /** Credits held by interviews still in progress: back when those end without an answer. */
  creditsPending: number;
  /** Trials left in the account's lifetime (0 or 1). */
  trial: number;
};

export type InterviewEntitlement = {
  plan: PlanId;
  source: EntitlementSource;
  /** Null when there is nothing to start. */
  agent: EntitlementAgent | null;
  /** The agent's hard limit; 0 when there is nothing to start. */
  maxDurationSeconds: number;
  remaining: EntitlementRemaining;
  reason: EntitlementReason;
  /** ISO date when the period's interviews come back; the period's end for a Pro, null otherwise. */
  resetsAt: string | null;
};

export type EntitlementFacts = {
  plan: PlanId;
  /** Non-refunded period interviews in the current period. */
  periodUsed: number;
  /** Pack credits held: grants minus revokes minus non-refunded consumption. */
  credits: number;
  creditsPending?: number;
  /** Non-refunded trials ever. */
  trialsUsed: number;
  /** A subscription at any time, or a full interview ever: no trial for this account. */
  hadVoice: boolean;
  /** The current quota period's end. */
  periodEnd: Date;
};

export const AGENT_SECONDS: Record<EntitlementAgent, number> = {
  main: INTERVIEW_TIERS.FULL.seconds,
  trial: INTERVIEW_TIERS.TRIAL.seconds,
};

export function decideEntitlement(facts: EntitlementFacts): InterviewEntitlement {
  const limits = PLANS[facts.plan];
  const periodLeft = Math.max(0, limits.interviewsPerMonth - facts.periodUsed);
  const trialLeft = facts.plan === "FREE" && !facts.hadVoice ? Math.max(0, limits.trialInterviews - facts.trialsUsed) : 0;
  const remaining: EntitlementRemaining = {
    period: periodLeft,
    periodLimit: limits.interviewsPerMonth,
    credits: Math.max(0, facts.credits),
    creditsPending: Math.max(0, facts.creditsPending ?? 0),
    trial: trialLeft,
  };
  const resetsAt = facts.plan === "PRO" ? facts.periodEnd.toISOString() : null;
  const main = (source: Extract<EntitlementSource, "period" | "credit">, reason: EntitlementReason): InterviewEntitlement => ({
    plan: facts.plan,
    source,
    agent: "main",
    maxDurationSeconds: AGENT_SECONDS.main,
    remaining,
    reason,
    resetsAt,
  });

  if (facts.plan === "PRO") {
    if (periodLeft > 0) return main("period", "period-left");
    if (remaining.credits > 0) return main("credit", "credit");
    return { plan: facts.plan, source: "none", agent: null, maxDurationSeconds: 0, remaining, reason: "period-used", resetsAt };
  }

  if (remaining.credits > 0) return main("credit", "credit");
  if (trialLeft > 0) {
    return { plan: facts.plan, source: "trial", agent: "trial", maxDurationSeconds: AGENT_SECONDS.trial, remaining, reason: "trial-available", resetsAt };
  }
  return {
    plan: facts.plan,
    source: "none",
    agent: null,
    maxDurationSeconds: 0,
    remaining,
    reason: facts.hadVoice ? "had-voice" : "trial-used",
    resetsAt,
  };
}

/** The ledger kind a source is reserved as; the agent tier it runs on. Both names are the Prisma enums' values. */
export const USAGE_KIND_BY_SOURCE = {
  period: "INTERVIEW",
  credit: "INTERVIEW_CREDIT",
  trial: "INTERVIEW_TRIAL",
} as const;

export const PAID_BY_SOURCE = {
  period: "PERIOD",
  credit: "CREDIT",
  trial: "TRIAL",
} as const;

export function tierOfAgent(agent: EntitlementAgent): InterviewTierId {
  return agent === "trial" ? "TRIAL" : "FULL";
}

/** What the room says beside the length, so the buyer knows what the start spends. */
export function sourceCopy(source: EntitlementSource | null): string | null {
  switch (source) {
    case "period":
      return "Uses one of this period's interviews.";
    case "credit":
      return "Uses one credit.";
    case "trial":
      return "Your free trial, on us.";
    default:
      return null;
  }
}

/** The source an interview row records, back into the entitlement's words. */
export function sourceOfPaidBy(paidBy: "PERIOD" | "CREDIT" | "TRIAL" | null | undefined): Exclude<EntitlementSource, "none"> | null {
  if (paidBy === "PERIOD") return "period";
  if (paidBy === "CREDIT") return "credit";
  if (paidBy === "TRIAL") return "trial";
  return null;
}
