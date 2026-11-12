import { describe, expect, it } from "vitest";
import { decideEntitlement, type EntitlementFacts } from "@/lib/interviewEntitlement";
import { decideRoomEntry, entryCanStart, waitingInterviewEntry, waitingReading } from "@/lib/interviewEntry";

const periodEnd = new Date("2026-12-01T00:00:00.000Z");
const entitlement = (facts: Partial<EntitlementFacts>) =>
  decideEntitlement({ plan: "FREE", periodUsed: 0, credits: 0, trialsUsed: 0, hadVoice: false, periodEnd, ...facts });
const base = { startCount: 0, maxStarts: 3, held: false, resumable: false, voiceUp: true };

describe("decideRoomEntry", () => {
  it("offers a start with what pays for it", () => {
    expect(decideRoomEntry({ ...base, entitlement: entitlement({}) })).toEqual({ kind: "start", source: "trial" });
    expect(decideRoomEntry({ ...base, entitlement: entitlement({ plan: "PRO", periodUsed: 1, hadVoice: true }) })).toEqual({ kind: "start", source: "period" });
    expect(decideRoomEntry({ ...base, entitlement: entitlement({ trialsUsed: 1, credits: 2 }) })).toEqual({ kind: "start", source: "credit" });
  });

  it("offers Pro to a Free account with nothing left, and the pack to a Pro one, with the renewal date", () => {
    expect(decideRoomEntry({ ...base, entitlement: entitlement({ trialsUsed: 1 }) })).toEqual({ kind: "needs-pro", reason: "trial-used" });
    expect(decideRoomEntry({ ...base, entitlement: entitlement({ hadVoice: true }) })).toEqual({ kind: "needs-pro", reason: "had-voice" });
    expect(decideRoomEntry({ ...base, entitlement: entitlement({ plan: "PRO", periodUsed: 4, hadVoice: true }) })).toEqual({ kind: "needs-pack", resetsAt: periodEnd.toISOString() });
  });

  it("lets a resumable or already paid interview continue whatever the counts", () => {
    const none = entitlement({ trialsUsed: 1 });
    expect(decideRoomEntry({ ...base, entitlement: none, resumable: true })).toEqual({ kind: "continue" });
    expect(decideRoomEntry({ ...base, entitlement: null, held: true })).toEqual({ kind: "continue" });
  });

  it("puts the start cap first, then voice down, and never sells while voice is down", () => {
    expect(decideRoomEntry({ ...base, startCount: 3, voiceUp: false, entitlement: entitlement({ trialsUsed: 1 }) })).toEqual({ kind: "start-cap" });
    expect(decideRoomEntry({ ...base, voiceUp: false, entitlement: entitlement({ trialsUsed: 1 }) })).toEqual({ kind: "voice-down" });
    expect(decideRoomEntry({ ...base, voiceUp: false, resumable: true, entitlement: null })).toEqual({ kind: "voice-down" });
  });
});

describe("the lists' reading", () => {
  it("reads a waiting row like its room, without asking the platform", () => {
    const now = new Date("2026-11-20T10:00:00.000Z");
    const row = { startCount: 0, held: false, resumableUntil: null };
    const used = entitlement({ trialsUsed: 1 });
    expect(waitingReading(waitingInterviewEntry(row, used, 3, now))).toBe("needsPro");
    expect(waitingReading(waitingInterviewEntry({ ...row, resumableUntil: "2026-11-20T10:05:00.000Z" }, used, 3, now))).toBe("ready");
    expect(waitingReading(waitingInterviewEntry({ ...row, resumableUntil: "2026-11-20T09:55:00.000Z" }, used, 3, now))).toBe("needsPro");
    expect(waitingReading(waitingInterviewEntry({ ...row, startCount: 3 }, used, 3, now))).toBe("noStarts");
    expect(entryCanStart(waitingInterviewEntry(row, entitlement({}), 3, now))).toBe(true);
  });
});
