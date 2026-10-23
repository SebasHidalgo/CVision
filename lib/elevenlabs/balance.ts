import { MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/interviewLimits";

/**
 * The voice platform's balance, and whether it can carry one more
 * interview. Pure: the client reads the subscription, the health check
 * caches it, the doctor prints it, and this is where the arithmetic lives.
 *
 * The platform bills a call in credits as it runs (the per-minute platform
 * charge plus the LLM pass-through); a workspace with no credits left
 * still issues the token, the agent fails to join a second later, and
 * the start was spent for nothing (seen live on 2026-10-23). The floor is
 * what a full interview costs with a margin, so a start is refused before
 * anything is reserved rather than after the candidate has heard silence.
 */

/**
 * Credits one minute of a full interview costs, measured on the owner's
 * five real calls of 2026-10-13 (free tier, no developer discount): 777 to
 * 844 credits per minute in total, of which about 660 was the platform's
 * per-minute charge and the rest the LLM. Rounded up to a round number;
 * the floor below multiplies it by the hard duration and a margin.
 */
export const VOICE_CREDITS_PER_MINUTE = 800;

/** Headroom over one full interview: the LLM share varies with how much is said. */
export const VOICE_BALANCE_MARGIN = 1.25;

/**
 * The default floor: one full interview (12 min x 800 credits = 9,600)
 * plus the margin, 12,000 credits. Override with
 * ELEVENLABS_BALANCE_FLOOR_CREDITS; 0 disables the check.
 */
export const VOICE_BALANCE_FLOOR_CREDITS = Math.ceil((MAX_INTERVIEW_DURATION_SECONDS / 60) * VOICE_CREDITS_PER_MINUTE * VOICE_BALANCE_MARGIN);

export const VOICE_BALANCE_FLOOR_ENV = "ELEVENLABS_BALANCE_FLOOR_CREDITS";

/** The floor in force: the env override when it is a whole number, else the default. */
export function readBalanceFloor(env: Record<string, string | undefined> = process.env): number {
  const raw = env[VOICE_BALANCE_FLOOR_ENV]?.trim();
  if (!raw) return VOICE_BALANCE_FLOOR_CREDITS;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : VOICE_BALANCE_FLOOR_CREDITS;
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
