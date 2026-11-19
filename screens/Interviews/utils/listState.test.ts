import { describe, expect, it } from "vitest";
import { decideEntitlement, type EntitlementFacts, type InterviewEntitlement } from "@/lib/interviewEntitlement";
import type { InterviewListItem } from "@/types/interview";
import { listState, timeLeft } from "./listState";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

const item = (overrides: Partial<InterviewListItem> = {}): InterviewListItem => ({
  id: "i1",
  role: "Backend Engineer",
  status: "SCHEDULED",
  createdAt: minutesAgo(30),
  analysisId: "a1",
  companyName: "Northwind",
  attemptNumber: 1,
  conversationId: null,
  hasTranscript: false,
  startCount: 0,
  startedAt: null,
  lastSessionAt: null,
  callAllowedSeconds: null,
  endedAt: null,
  failureReason: null,
  held: false,
  resumableUntil: null,
  lastEnd: null,
  score: null,
  secondsLeft: null,
  ...overrides,
});

const entitlement = (overrides: Partial<EntitlementFacts> = {}): InterviewEntitlement =>
  decideEntitlement({ plan: "PRO", periodUsed: 0, credits: 0, trialsUsed: 0, hadVoice: true, periodEnd: inMinutes(60 * 24 * 10), ...overrides });

const state = (overrides: Partial<InterviewListItem>, e: InterviewEntitlement | null = entitlement()) => listState(item(overrides), e, NOW);

describe("listState", () => {
  it("done carries its score; pending, failed and expired are what their status says", () => {
    expect(state({ status: "COMPLETED", score: 74 })).toEqual({ kind: "done", score: 74 });
    expect(state({ status: "COMPLETED" })).toEqual({ kind: "done", score: null });
    expect(state({ status: "FEEDBACK_PENDING" })).toEqual({ kind: "pending" });
    expect(state({ status: "GENERATING" })).toEqual({ kind: "pending" });
    expect(state({ status: "FAILED", failureReason: "FEEDBACK_FAILED" })).toEqual({ kind: "failed" });
    expect(state({ status: "EXPIRED" })).toEqual({ kind: "expired" });
  });

  it("a dropped call with time left is resumable; one the interviewer or the platform ended is an early end", () => {
    const resumable = { status: "IN_PROGRESS" as const, conversationId: "c1", hasTranscript: true, held: true, startCount: 1, resumableUntil: inMinutes(8), secondsLeft: 284 };
    expect(state({ ...resumable, lastEnd: "disconnect" })).toEqual({ kind: "resumable", early: false, secondsLeft: 284 });
    expect(state({ ...resumable, lastEnd: "interviewer" })).toEqual({ kind: "resumable", early: true, secondsLeft: 284 });
    expect(state({ ...resumable, lastEnd: "platform" })).toEqual({ kind: "resumable", early: true, secondsLeft: 284 });
    // The window closed (the sweep scores it next): not offered as resumable any more.
    expect(state({ ...resumable, resumableUntil: minutesAgo(1) }).kind).not.toBe("resumable");
    // The data layer found nothing to resume (too little time, no starts): no time-left reading.
    expect(state({ ...resumable, secondsLeft: null }).kind).not.toBe("resumable");
  });

  it("a session with no record is live until the room reported its end or the call must be over, then saving", () => {
    const open = { status: "IN_PROGRESS" as const, conversationId: "c1", hasTranscript: false, held: true, startCount: 1 };
    expect(state({ ...open, startedAt: minutesAgo(3) })).toEqual({ kind: "live" });
    expect(state({ ...open, startedAt: minutesAgo(3), endedAt: minutesAgo(3) })).toEqual({ kind: "saving" });
    expect(state({ ...open, startedAt: minutesAgo(40) })).toEqual({ kind: "saving" });
  });

  it("a late reconnect is live on its own clock, not the first call's", () => {
    // First call 16 min ago, reconnect issued 2 min ago with 6 min left: the old rule read it as saving.
    const open = { status: "IN_PROGRESS" as const, conversationId: "c2", hasTranscript: false, held: true, startCount: 2 };
    expect(state({ ...open, startedAt: minutesAgo(16), lastSessionAt: minutesAgo(2), callAllowedSeconds: 360 })).toEqual({ kind: "live" });
    expect(state({ ...open, startedAt: minutesAgo(30), lastSessionAt: minutesAgo(12), callAllowedSeconds: 360 })).toEqual({ kind: "saving" });
  });

  it("a waiting one is ready only when the plan can start it, and says what it lacks otherwise", () => {
    expect(state({})).toEqual({ kind: "ready" });
    expect(state({}, entitlement({ periodUsed: 4 }))).toEqual({ kind: "needsPack" });
    expect(state({}, entitlement({ plan: "FREE" }))).toEqual({ kind: "needsPro" });
    expect(state({ startCount: 3 })).toEqual({ kind: "noStarts" });
    // It already holds its unit: it continues whatever the plan has left.
    expect(
      state({ status: "IN_PROGRESS", held: true, startCount: 1, failureReason: "NO_CANDIDATE_TURNS", conversationId: "c1", hasTranscript: true }, entitlement({ periodUsed: 4 })),
    ).toEqual({ kind: "ready" });
    // Without the entitlement, a waiting one reads ready.
    expect(state({}, null)).toEqual({ kind: "ready" });
  });

  it("formats the time left as the room does", () => {
    expect(timeLeft(284)).toBe("4:44");
    expect(timeLeft(59.9)).toBe("0:59");
    expect(timeLeft(-5)).toBe("0:00");
  });
});
