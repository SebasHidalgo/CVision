import { describe, expect, it } from "vitest";
import { decideEntitlement, type EntitlementFacts } from "@/lib/interviewEntitlement";
import type { InterviewAttempt } from "@/types/resume";
import { anyWaiting, attemptSummary } from "./attemptSummary";

const now = new Date("2026-11-20T10:00:00.000Z");
const entitlement = (facts: Partial<EntitlementFacts>) =>
  decideEntitlement({ plan: "FREE", periodUsed: 0, credits: 0, trialsUsed: 0, hadVoice: false, periodEnd: new Date("2026-12-01T00:00:00.000Z"), ...facts });
const attempt = (patch: Partial<InterviewAttempt>): InterviewAttempt => ({
  id: "i1",
  status: "SCHEDULED",
  attemptNumber: 1,
  failureReason: null,
  totalScore: null,
  createdAt: "2026-11-19T10:00:00.000Z",
  startCount: 0,
  held: false,
  resumableUntil: null,
  ...patch,
});

describe("attemptSummary", () => {
  it("is nothing without a rehearsal", () => {
    expect(attemptSummary([], null, now)).toBeNull();
  });

  it("reads the latest rehearsal (attempts come newest first) and counts the earlier ones", () => {
    const attempts = [attempt({ attemptNumber: 3, status: "COMPLETED", totalScore: 74 }), attempt({ attemptNumber: 2, status: "FAILED" }), attempt({})];
    expect(attemptSummary(attempts, null, now)).toEqual({ number: 3, reading: "scored", score: 74, earlier: 2 });
    expect(attemptSummary([attempt({ status: "COMPLETED" })], null, now)).toMatchObject({ reading: "completed", score: null });
    expect(attemptSummary([attempt({ status: "GENERATING" })], null, now)).toMatchObject({ reading: "pending" });
    expect(attemptSummary([attempt({ status: "FAILED" })], null, now)).toMatchObject({ reading: "failed" });
    expect(attemptSummary([attempt({ status: "EXPIRED" })], null, now)).toMatchObject({ reading: "expired" });
  });

  it("reads a waiting rehearsal as its room does: ready only when the plan can start it", () => {
    const waiting = [attempt({ status: "IN_PROGRESS" })];
    expect(attemptSummary(waiting, entitlement({}), now)).toMatchObject({ reading: "ready" });
    expect(attemptSummary(waiting, entitlement({ trialsUsed: 1 }), now)).toMatchObject({ reading: "needsPro" });
    expect(attemptSummary(waiting, entitlement({ plan: "PRO", periodUsed: 4, hadVoice: true }), now)).toMatchObject({ reading: "needsPack" });
    expect(attemptSummary([attempt({ startCount: 3 })], entitlement({}), now)).toMatchObject({ reading: "noStarts" });
    // A rehearsal holding its unit continues whatever the plan says.
    expect(attemptSummary([attempt({ held: true })], entitlement({ trialsUsed: 1 }), now)).toMatchObject({ reading: "ready" });
    // The entitlement wasn't read: nothing to compare against.
    expect(attemptSummary(waiting, null, now)).toMatchObject({ reading: "ready" });
  });

  it("anyWaiting looks at each analysis's latest rehearsal", () => {
    expect(anyWaiting([[], [attempt({ status: "COMPLETED" })]])).toBe(false);
    expect(anyWaiting([[attempt({ status: "COMPLETED" })], [attempt({ status: "SCHEDULED" })]])).toBe(true);
  });
});
