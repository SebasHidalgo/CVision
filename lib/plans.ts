import { MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/interviewLimits";

/**
 * The product's limits, in one place. Every quota and rate-limit number the
 * app enforces or shows comes from here; nothing else hard-codes one. The
 * plan numbers are the owner's decisions, not tunables. Import-free beyond
 * the interview limits, so client components can read copy from it.
 *
 * Until billing (M6) every account is FREE unless set to PRO by hand
 * (`npm run user:set-plan`). The quota period is the calendar month in UTC
 * for both plans; M6 replaces PRO's period with the billing period, which is
 * why the period is one function below and nothing else.
 */

export type PlanId = "FREE" | "PRO";

/** A voice interview runs on one of two agents: the five-minute trial, or the full one. */
export type InterviewTierId = "TRIAL" | "FULL";

export type PlanLimits = {
  /** Analyses per period. */
  analysesPerMonth: number;
  /**
   * Whether the UI says how many analyses are left. PRO's number is a
   * fair-use cap sold as "unlimited": shown only once it is hit.
   */
  announceAnalyses: boolean;
  /** Full interviews per period. */
  interviewsPerMonth: number;
  /** Trial interviews in the account's lifetime, for an account that never had voice. */
  trialInterviews: number;
  /** Which agent an interview of this plan runs on. */
  interviewTier: InterviewTierId;
  /**
   * How many of the most recent analyses the plan shows; null for all.
   * Older ones are hidden, never deleted: the lists leave them out and
   * their pages answer with an upgrade notice, and Pro reveals them.
   */
  historyLimit: number | null;
};

export const PLANS: Record<PlanId, PlanLimits> = {
  FREE: {
    analysesPerMonth: 3,
    announceAnalyses: true,
    interviewsPerMonth: 0,
    trialInterviews: 1,
    interviewTier: "TRIAL",
    historyLimit: 3,
  },
  PRO: {
    analysesPerMonth: 50,
    announceAnalyses: false,
    interviewsPerMonth: 4,
    trialInterviews: 0,
    interviewTier: "FULL",
    historyLimit: null,
  },
};

export type InterviewTier = {
  /** The agent's hard limit. The platform enforces it; the room shows it. */
  seconds: number;
  /**
   * How many gaps the interviewer is briefed to probe. The trial has time
   * for two questions and their follow-ups; the full interview lists every
   * gap the context budget fits (its own cap is in the prompt builder).
   */
  gapsToCover: number;
};

export const INTERVIEW_TIERS: Record<InterviewTierId, InterviewTier> = {
  TRIAL: { seconds: 5 * 60, gapsToCover: 2 },
  FULL: { seconds: MAX_INTERVIEW_DURATION_SECONDS, gapsToCover: 30 },
};

export const TRIAL_INTERVIEW_SECONDS = INTERVIEW_TIERS.TRIAL.seconds;

/**
 * The interview pack: a one-time purchase, Pro only, this many credits. A
 * credit is one full interview once the period's are used; credits never
 * expire and are frozen (kept, unusable) while Pro is not active. The price
 * is in lib/billing/catalog.ts beside the subscription's.
 */
export const INTERVIEW_PACK_CREDITS = 5;

/**
 * Hourly, per user, the same for both plans. A brake on loops and abuse,
 * not a product limit: the quotas above are those. The status endpoint is
 * polled every 3 to 10 seconds by design, and two tabs of the same page
 * poll independently, so its ceiling is per minute and generous, there only
 * to stop a runaway loop.
 */
export const RATE_LIMITS = {
  analysis: { limit: 10, windowMs: 60 * 60_000 },
  uploadUrl: { limit: 20, windowMs: 60 * 60_000 },
  interviewStart: { limit: 6, windowMs: 60 * 60_000 },
  interviewCreate: { limit: 3, windowMs: 60 * 60_000 },
  status: { limit: 60, windowMs: 60_000 },
  /** Checkouts and portal links: each is a provider call that creates a record there. */
  checkout: { limit: 10, windowMs: 60 * 60_000 },
  portal: { limit: 10, windowMs: 60 * 60_000 },
  /** "Check again" after a checkout whose confirmation is late: two provider reads per press. */
  reconcile: { limit: 6, windowMs: 60 * 60_000 },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

/** What the new-analysis page shows: the Free allowance, or nothing until Pro's fair-use cap is hit. */
export type AnalysisQuotaView = {
  plan: PlanId;
  left: number;
  limit: number;
  /** False for PRO: its number is a fair-use cap, not an announced quota. */
  announce: boolean;
  /** ISO date of the next reset. */
  resetsAt: string;
};

/** What the analysis page's interview control shows. */
export type InterviewQuotaView = {
  plan: PlanId;
  trialAvailable: boolean;
  left: number;
  limit: number;
  /** Pack credits held; usable only while Pro is active, kept otherwise. */
  credits: number;
  creditsUsable: boolean;
  /** ISO date of the next reset. */
  resetsAt: string;
};

export type QuotaPeriod = { start: Date; end: Date };

/**
 * The calendar month of `now`, in UTC: [start, end). The period of every
 * Free and comped account; a subscribed Pro's period is its billing period
 * (`quotaPeriodFor` in lib/billing/access.ts).
 */
export function quotaPeriod(now: Date): QuotaPeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/** "Nov 1": the day the period's quota comes back, as the UI says it. */
export function formatResetDate(end: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(end);
}
