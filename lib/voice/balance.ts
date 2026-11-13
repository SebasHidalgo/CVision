import { INTERVIEW_GRACE_SECONDS, MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/interviewLimits";

/**
 * The voice platform's balance, and whether it can carry one more
 * interview. Pure: the client reads the subscription, the health check
 * caches it, the doctor prints it, and this is where the arithmetic lives.
 *
 * The platform bills a call in credits as it runs (the per-minute platform
 * charge plus the LLM pass-through); a workspace with no credits left
 * still issues the token, the agent fails to join a second later, and
 * the start was spent for nothing (seen live on 2026-10-23). The floor is
 * what the interview about to start costs, with a margin, so a start is
 * refused before anything is reserved rather than after the candidate has
 * heard silence.
 *
 *   floor = minutes of the agent's hard limit (the paid length plus the
 *           grace for the last answer and the goodbye) x credits a minute x margin
 */

/** The longest a call of this paid length can run on the platform. */
const hardLimitSeconds = (paidSeconds: number) => paidSeconds + INTERVIEW_GRACE_SECONDS;

/** Credits a call minute costs: 451 on Starter (398 call + 53 LLM), measured with voice:cost on 2026-11-12. */
export const VOICE_CREDITS_PER_MINUTE = 451;

export const VOICE_CREDITS_PER_MINUTE_ENV = "ELEVENLABS_CREDITS_PER_MINUTE";

/** Headroom for the LLM share, the part that moves (47 to 74 a minute measured): covers three times it. */
export const VOICE_BALANCE_MARGIN = 1.25;

/** What a call past the plan's concurrency limit costs: bursting charges twice the rate. */
export const VOICE_BURST_RATE = 2;

/** The rate in force: the env override when it is a positive whole number, else the measured one. */
export function readCreditsPerMinute(env: Record<string, string | undefined> = process.env): number {
  const raw = env[VOICE_CREDITS_PER_MINUTE_ENV]?.trim();
  const value = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
  return value > 0 ? value : VOICE_CREDITS_PER_MINUTE;
}

/** What an interview of this paid length costs at most at the rate in force (the grace used in full), without the margin. */
export function interviewCredits(maxDurationSeconds: number, env: Record<string, string | undefined> = process.env): number {
  return Math.ceil((hardLimitSeconds(maxDurationSeconds) / 60) * readCreditsPerMinute(env));
}

/** The same interview at the burst rate. Not in the floor: bursting means many calls at once, which no single floor holds. */
export function burstInterviewCredits(maxDurationSeconds: number, env: Record<string, string | undefined> = process.env): number {
  return interviewCredits(maxDurationSeconds, env) * VOICE_BURST_RATE;
}

/** The floor for an agent of this paid length: its hard limit at the rate in force, plus the margin. On Starter, 12 min: 7,329 credits; the 5-minute trial: 3,383. */
export function voiceBalanceFloor(maxDurationSeconds: number, env: Record<string, string | undefined> = process.env): number {
  return Math.ceil((hardLimitSeconds(maxDurationSeconds) / 60) * readCreditsPerMinute(env) * VOICE_BALANCE_MARGIN);
}

/** The full interview's floor at the measured rate, the largest any start needs. */
export const VOICE_BALANCE_FLOOR_CREDITS = voiceBalanceFloor(MAX_INTERVIEW_DURATION_SECONDS, {});

export const VOICE_BALANCE_FLOOR_ENV = "ELEVENLABS_BALANCE_FLOOR_CREDITS";

/** The floor in force for an agent: the env override when it is a whole number (0 turns the check off), else the agent's own. */
export function readBalanceFloor(maxDurationSeconds: number, env: Record<string, string | undefined> = process.env): number {
  const own = voiceBalanceFloor(maxDurationSeconds, env);
  const raw = env[VOICE_BALANCE_FLOOR_ENV]?.trim();
  if (!raw) return own;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : own;
}

/** How many interviews of this length the reachable balance pays for at the rate in force. */
export function interviewsCovered(availableCredits: number, maxDurationSeconds: number, env: Record<string, string | undefined> = process.env): number {
  const each = interviewCredits(maxDurationSeconds, env);
  if (!Number.isFinite(availableCredits)) return Number.POSITIVE_INFINITY;
  return each > 0 ? Math.floor(Math.max(0, availableCredits) / each) : 0;
}

/** What `GET /v1/user/subscription` says, reduced to what a start needs. */
export type VoiceBalance = {
  /** The plan's name as the platform reports it ("free", "creator", ...). */
  tier: string;
  /** The subscription's status ("active", "free", "past_due", ...). */
  status: string;
  creditsUsed: number;
  creditsLimit: number;
  /** `creditsLimit - creditsUsed`, never negative. */
  creditsRemaining: number;
  /**
   * How far past the limit the workspace may go on usage-based billing:
   * a number of credits, "unlimited", or 0 when it is off (every new
   * self-serve plan: those prepay credits instead, which the limit already
   * includes).
   */
  extension: number | "unlimited";
  resetsAt: Date | null;
};

export type VoiceCapacity = {
  ok: boolean;
  /** Credits left in the period. */
  remaining: number;
  /** Credits reachable before the platform refuses a call: the remaining plus the usage-based extension. */
  available: number;
  floor: number;
};

/** Whether the balance clears the floor. A floor of 0 means the check is off. */
export function decideVoiceCapacity(balance: VoiceBalance, floor: number): VoiceCapacity {
  const extension = balance.extension === "unlimited" ? Number.POSITIVE_INFINITY : Math.max(0, balance.extension);
  const available = balance.creditsRemaining + extension;
  return { ok: floor === 0 || available >= floor, remaining: balance.creditsRemaining, available, floor };
}

/** The balance in one line for a log or a doctor check; never a secret. */
export function describeVoiceBalance(balance: VoiceBalance): string {
  const extension = balance.extension === "unlimited" ? "unlimited usage-based extension" : balance.extension > 0 ? `${balance.extension} credits of usage-based extension` : "no usage-based extension";
  const reset = balance.resetsAt ? `, resets ${balance.resetsAt.toISOString().slice(0, 10)}` : "";
  return `${balance.tier} plan (${balance.status}): ${balance.creditsRemaining} of ${balance.creditsLimit} credits left, ${extension}${reset}`;
}
