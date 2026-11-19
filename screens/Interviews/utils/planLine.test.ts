import { describe, expect, it } from "vitest";
import { decideEntitlement, type EntitlementFacts } from "@/lib/interviewEntitlement";
import { planLine } from "./planLine";

const RESET = "2026-12-01T00:00:00.000Z";
const line = (overrides: Partial<EntitlementFacts>) =>
  planLine(decideEntitlement({ plan: "PRO", periodUsed: 0, credits: 0, trialsUsed: 0, hadVoice: true, periodEnd: new Date(RESET), ...overrides }));

describe("planLine", () => {
  it("Pro: the period's count, its credits, and the reset; never the analyses", () => {
    expect(line({ periodUsed: 1 })).toEqual({ plan: "PRO", parts: [{ key: "period", count: 3, limit: 4 }, { key: "resets", resetsAt: RESET }], link: null });
    expect(line({ periodUsed: 4, credits: 2 })).toEqual({
      plan: "PRO",
      parts: [{ key: "period", count: 0, limit: 4 }, { key: "credits", count: 2 }, { key: "resets", resetsAt: RESET }],
      link: null,
    });
  });

  it("Pro with nothing left: when it comes back, and the way to more", () => {
    expect(line({ periodUsed: 4 })).toEqual({ plan: "PRO", parts: [{ key: "periodUsed", resetsAt: RESET }], link: "getMore" });
  });

  it("Free: credits as full interviews, the trial for an account that never had voice, else Pro", () => {
    expect(line({ plan: "FREE", credits: 1 })).toEqual({ plan: "FREE", parts: [{ key: "creditsFree", count: 1, minutes: 12 }], link: null });
    expect(line({ plan: "FREE", hadVoice: false })).toEqual({ plan: "FREE", parts: [{ key: "trial", minutes: 5 }], link: null });
    expect(line({ plan: "FREE", hadVoice: false, credits: 2 }).parts.map((part) => part.key)).toEqual(["creditsFree", "trial"]);
    expect(line({ plan: "FREE" })).toEqual({ plan: "FREE", parts: [{ key: "needsPro" }], link: "seePro" });
  });
});
