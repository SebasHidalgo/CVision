import { describe, expect, it } from "vitest";
import type { UsageSummary } from "@/lib/database/usage";
import { decideEntitlement } from "@/lib/interviewEntitlement";
import { PLANS, type PlanId } from "@/lib/plans";
import { accountView } from "./accountView";

const PERIOD_END = new Date("2026-12-01T00:00:00.000Z");

type Facts = { analysesUsed?: number; periodUsed?: number; credits?: number; pending?: number; trialsUsed?: number; hadVoice?: boolean; source?: UsageSummary["source"]; subscription?: UsageSummary["subscription"] };

/** A summary as the ledger would report it, the entitlement decided on the same facts. */
function summaryOf(plan: PlanId, facts: Facts = {}): UsageSummary {
  const { analysesUsed = 1, periodUsed = 0, credits = 0, pending = 0, trialsUsed = 0, hadVoice = false } = facts;
  const entitlement = decideEntitlement({ plan, periodUsed, credits, trialsUsed, hadVoice, periodEnd: PERIOD_END });
  const limit = PLANS[plan].analysesPerMonth;
  return {
    plan,
    source: facts.source ?? (plan === "PRO" ? "comp" : "free"),
    analyses: { used: analysesUsed, limit, left: Math.max(0, limit - analysesUsed), announce: PLANS[plan].announceAnalyses },
    interviews: { used: periodUsed, limit: PLANS[plan].interviewsPerMonth, left: entitlement.remaining.period },
    credits: { balance: credits, pending },
    trial: { available: entitlement.remaining.trial > 0, used: trialsUsed > 0 },
    entitlement,
    period: { start: new Date("2026-11-01T00:00:00.000Z"), end: PERIOD_END },
    resetsAt: PERIOD_END,
    subscription: facts.subscription ?? null,
    everSubscribed: hadVoice,
    hasBillingAccount: false,
  };
}

describe("accountView", () => {
  it("gives a new Free account its analyses counted and its trial, never an interview period of zero", () => {
    const view = accountView(summaryOf("FREE"));
    expect(view.standing).toEqual({ kind: "free" });
    expect(view.period).toEqual({ kind: "resets", date: PERIOD_END });
    expect(view.analyses).toEqual({ kind: "count", left: 2, limit: 3 });
    expect(view.interviews).toEqual({ kind: "trial", state: "available", note: "available", minutes: 5 });
    expect(view.credits).toBeNull();
  });

  it("tells Free apart when the trial is used, never offered, or covered by credits", () => {
    expect(accountView(summaryOf("FREE", { trialsUsed: 1 })).interviews).toMatchObject({ state: "used", note: "pro-only" });
    expect(accountView(summaryOf("FREE", { hadVoice: true })).interviews).toMatchObject({ state: "unavailable", note: "unavailable" });
    const withCredits = accountView(summaryOf("FREE", { hadVoice: true, credits: 3 }));
    expect(withCredits.interviews).toMatchObject({ state: "unavailable", note: "credits-cover" });
    expect(withCredits.credits).toEqual({ balance: 3, pending: 0, note: "free" });
  });

  it("names Pro's analyses as a cap, never a count, until the cap is reached", () => {
    expect(accountView(summaryOf("PRO", { analysesUsed: 12 })).analyses).toEqual({ kind: "up-to", limit: 50, reached: false });
    expect(accountView(summaryOf("PRO", { analysesUsed: 50 })).analyses).toEqual({ kind: "up-to", limit: 50, reached: true });
  });

  it("counts Pro's period interviews and always shows its credits, even at zero", () => {
    const view = accountView(summaryOf("PRO", { periodUsed: 1, hadVoice: true }));
    expect(view.standing).toEqual({ kind: "comp" });
    expect(view.interviews).toEqual({ kind: "period", left: 3, limit: 4, minutes: 12 });
    expect(view.credits).toEqual({ balance: 0, pending: 0, note: "none" });
  });

  it("says when Pro ends instead of a reset that would never come for a scheduled cancellation", () => {
    const endsAt = new Date("2026-11-28T00:00:00.000Z");
    const view = accountView(
      summaryOf("PRO", {
        source: "subscription",
        subscription: {
          id: "row",
          providerSubscriptionId: "sub",
          status: "ACTIVE",
          priceKey: "pro_monthly",
          currentPeriodStart: new Date("2026-10-28T00:00:00.000Z"),
          currentPeriodEnd: endsAt,
          cancelAtPeriodEnd: true,
          scheduledChangeAt: endsAt,
          canceledAt: null,
          providerUpdatedAt: new Date("2026-11-02T00:00:00.000Z"),
        },
      }),
    );
    expect(view.standing).toEqual({ kind: "cancels", endsAt });
    expect(view.period).toEqual({ kind: "pro-ends", date: endsAt });
  });
});
