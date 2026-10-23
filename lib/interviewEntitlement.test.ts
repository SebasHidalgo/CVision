import { describe, expect, it } from "vitest";
import { AGENT_SECONDS, decideEntitlement, PAID_BY_SOURCE, sourceCopy, sourceOfPaidBy, tierOfAgent, USAGE_KIND_BY_SOURCE, type EntitlementFacts } from "./interviewEntitlement";
import { INTERVIEW_TIERS, PLANS } from "./plans";

const PERIOD_END = new Date("2026-11-05T00:00:00Z");
const facts = (overrides: Partial<EntitlementFacts> = {}): EntitlementFacts => ({
  plan: "FREE",
  periodUsed: 0,
  credits: 0,
  creditsPending: 0,
  trialsUsed: 0,
  hadVoice: false,
  periodEnd: PERIOD_END,
  ...overrides,
});

describe("decideEntitlement: the one answer to which interview the next start gets", () => {
  it("a Pro takes the period's interviews first, on the main agent for twelve minutes, with the period's end as the reset", () => {
    expect(decideEntitlement(facts({ plan: "PRO", periodUsed: 1, credits: 3 }))).toEqual({
      plan: "PRO",
      source: "period",
      agent: "main",
      maxDurationSeconds: INTERVIEW_TIERS.FULL.seconds,
      remaining: { period: 3, periodLimit: PLANS.PRO.interviewsPerMonth, credits: 3, creditsPending: 0, trial: 0 },
      reason: "period-left",
      resetsAt: PERIOD_END.toISOString(),
    });
  });

  it("a Pro with the period used takes a credit, and with none left gets nothing, back at the period's end", () => {
    expect(decideEntitlement(facts({ plan: "PRO", periodUsed: 4, credits: 2 }))).toMatchObject({ source: "credit", agent: "main", maxDurationSeconds: 720, reason: "credit" });
    expect(decideEntitlement(facts({ plan: "PRO", periodUsed: 4, credits: 0 }))).toMatchObject({
      source: "none",
      agent: null,
      maxDurationSeconds: 0,
      reason: "period-used",
      resetsAt: PERIOD_END.toISOString(),
      remaining: { period: 0, credits: 0 },
    });
  });

  it("a Free account takes a credit before anything else: a full interview on the main agent, even after its Pro ended", () => {
    expect(decideEntitlement(facts({ credits: 4, hadVoice: true }))).toMatchObject({ source: "credit", agent: "main", maxDurationSeconds: 720, reason: "credit", resetsAt: null });
    // With credits and an unused trial, the credit still goes first and the trial stays counted as remaining.
    expect(decideEntitlement(facts({ credits: 1 }))).toMatchObject({ source: "credit", remaining: { credits: 1, trial: 1 } });
  });

  it("a Free account with no credits gets its one trial on the trial agent for five minutes, once, and only if it never had voice", () => {
    expect(decideEntitlement(facts())).toMatchObject({ source: "trial", agent: "trial", maxDurationSeconds: AGENT_SECONDS.trial, reason: "trial-available", remaining: { trial: 1 } });
    expect(decideEntitlement(facts({ trialsUsed: 1 }))).toMatchObject({ source: "none", agent: null, reason: "trial-used", remaining: { trial: 0 } });
    expect(decideEntitlement(facts({ hadVoice: true }))).toMatchObject({ source: "none", reason: "had-voice", remaining: { trial: 0 } });
  });

  it("carries the credits held by open interviews, so a page can say they are pending return", () => {
    expect(decideEntitlement(facts({ credits: 3, creditsPending: 1 })).remaining).toMatchObject({ credits: 3, creditsPending: 1 });
  });

  it("maps a source to its ledger kind, its agent tier and the row's paidBy, and back", () => {
    expect(USAGE_KIND_BY_SOURCE).toEqual({ period: "INTERVIEW", credit: "INTERVIEW_CREDIT", trial: "INTERVIEW_TRIAL" });
    expect(PAID_BY_SOURCE).toEqual({ period: "PERIOD", credit: "CREDIT", trial: "TRIAL" });
    expect(tierOfAgent("main")).toBe("FULL");
    expect(tierOfAgent("trial")).toBe("TRIAL");
    expect(sourceOfPaidBy("CREDIT")).toBe("credit");
    expect(sourceOfPaidBy(null)).toBeNull();
    expect(sourceCopy("credit")).toBe("Uses one credit.");
    expect(sourceCopy("trial")).toMatch(/free trial/);
    expect(sourceCopy("none")).toBeNull();
  });
});
