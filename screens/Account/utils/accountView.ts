import { accountStanding, creditsView, type AccountStanding, type CreditsView } from "@/lib/accountStanding";
import type { UsageSummary } from "@/lib/database/usage";
import { INTERVIEW_TIERS, PLANS } from "@/lib/plans";

/**
 * What the account page shows, from the usage summary: the standing, this
 * period's analyses and interviews, the trial and the credits. Only what the
 * plan has: Free has no period interviews, so it shows the trial, never "0
 * of 0"; Pro's analyses are "up to 50" (the cap is named, never counted
 * against, until it is reached, as on the upload page).
 */
export type AccountView = {
  standing: AccountStanding;
  /** The line over the period's figures: when the counters reset, or when Pro ends with a scheduled cancellation. */
  period: { kind: "resets"; date: Date } | { kind: "pro-ends"; date: Date };
  analyses: { kind: "count"; left: number; limit: number } | { kind: "up-to"; limit: number; reached: boolean };
  interviews:
    | { kind: "period"; left: number; limit: number; minutes: number }
    | {
        kind: "trial";
        /** "claimed": the account's email already used its free trial on another account. */
        state: "available" | "used" | "claimed" | "unavailable";
        note: "available" | "credits-cover" | "pro-only" | "claimed" | "unavailable";
        minutes: number;
      };
  credits: CreditsView | null;
};

const TRIAL_MINUTES = INTERVIEW_TIERS.TRIAL.seconds / 60;
const FULL_MINUTES = INTERVIEW_TIERS.FULL.seconds / 60;

type ViewInput = Pick<UsageSummary, "plan" | "source" | "subscription" | "resetsAt" | "analyses" | "interviews" | "credits" | "trial">;

export function accountView(summary: ViewInput): AccountView {
  const standing = accountStanding(summary);
  const pro = summary.plan === "PRO";

  const period: AccountView["period"] = standing.kind === "cancels" ? { kind: "pro-ends", date: standing.endsAt } : { kind: "resets", date: summary.resetsAt };

  const analyses: AccountView["analyses"] = summary.analyses.announce
    ? { kind: "count", left: summary.analyses.left, limit: summary.analyses.limit }
    : { kind: "up-to", limit: summary.analyses.limit, reached: summary.analyses.left === 0 };

  let interviews: AccountView["interviews"];
  if (pro) {
    interviews = { kind: "period", left: summary.interviews.left, limit: summary.interviews.limit, minutes: FULL_MINUTES };
  } else {
    const { trial } = summary;
    const state = trial.available ? "available" : trial.used ? "used" : trial.blocked === "claimed" ? "claimed" : "unavailable";
    // A trial that could not be checked (fail closed) says only what is certain: voice is Pro's.
    const note =
      state === "available"
        ? "available"
        : summary.credits.balance > 0
          ? "credits-cover"
          : state === "claimed"
            ? "claimed"
            : state === "used" || trial.blocked === "unavailable"
              ? "pro-only"
              : "unavailable";
    interviews = { kind: "trial", state, note, minutes: TRIAL_MINUTES };
  }

  return { standing, period, analyses, interviews, credits: creditsView(summary) };
}

/**
 * The paid time deleting the account throws away: deletion cancels a subscription at once (`effective_from:
 * immediately`), so Pro that would have run to a date ends now. Renewing and canceling-at-period-end both hold a
 * period already paid for. Past due does not: its period is the one whose charge failed and is being retried. A comp
 * was never paid, and paused or ended subscriptions give no Pro to lose.
 */
export function forfeitedPeriodEnd(standing: AccountStanding): Date | null {
  if (standing.kind === "active") return standing.renewsAt;
  if (standing.kind === "cancels") return standing.endsAt;
  return null;
}

/** Pro's figures, for the copy that names them. */
export const PRO_FACTS = { interviewsPerMonth: PLANS.PRO.interviewsPerMonth, minutes: FULL_MINUTES } as const;
