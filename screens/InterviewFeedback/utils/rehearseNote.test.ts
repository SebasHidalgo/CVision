import { describe, expect, it } from "vitest";
import { decideEntitlement, type EntitlementFacts } from "@/lib/interviewEntitlement";
import { rehearseNote } from "./rehearseNote";

const facts = (overrides: Partial<EntitlementFacts>): EntitlementFacts => ({
  plan: "PRO",
  periodUsed: 1,
  credits: 0,
  trialsUsed: 0,
  hadVoice: true,
  periodEnd: new Date("2026-12-01T00:00:00.000Z"),
  ...overrides,
});
const note = (overrides: Partial<EntitlementFacts>) => rehearseNote(decideEntitlement(facts(overrides)));

describe("rehearseNote", () => {
  it("Pro: the period's interviews left, then the credits when there are any", () => {
    expect(note({})).toEqual({ canStart: true, parts: [{ key: "period", count: 3, limit: 4 }] });
    expect(note({ credits: 2 })).toEqual({ canStart: true, parts: [{ key: "period", count: 3, limit: 4 }, { key: "credits", count: 2 }] });
    // The period used up: credits pay for the next one.
    expect(note({ periodUsed: 4, credits: 1 })).toEqual({ canStart: true, parts: [{ key: "period", count: 0, limit: 4 }, { key: "credits", count: 1 }] });
  });

  it("Pro with nothing left: when the period's interviews come back, and no start on offer", () => {
    expect(note({ periodUsed: 4 })).toEqual({ canStart: false, parts: [{ key: "periodUsed", resetsAt: "2026-12-01T00:00:00.000Z" }] });
  });

  it("Free: its credits are full interviews; then the trial if it never had voice; else Pro", () => {
    expect(note({ plan: "FREE", credits: 2 })).toEqual({ canStart: true, parts: [{ key: "creditsLeft", count: 2 }] });
    expect(note({ plan: "FREE", hadVoice: false })).toEqual({ canStart: true, parts: [{ key: "trial", minutes: 5 }] });
    expect(note({ plan: "FREE", hadVoice: false, trialsUsed: 1 })).toEqual({ canStart: false, parts: [{ key: "needsPro" }] });
    expect(note({ plan: "FREE" })).toEqual({ canStart: false, parts: [{ key: "needsPro" }] });
  });
});
