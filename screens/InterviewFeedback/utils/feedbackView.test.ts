import { describe, expect, it } from "vitest";
import { RECONCILE_GRACE_SECONDS } from "@/lib/elevenlabs/postCall";
import { decideFeedbackView, type FeedbackViewInput } from "./feedbackView";

const NOW = new Date("2026-10-13T12:00:00Z");
const MAX = 720;
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const input = (overrides: Partial<FeedbackViewInput> = {}): FeedbackViewInput => ({
  status: "IN_PROGRESS",
  conversationId: "conv_1",
  hasTranscript: false,
  startedAt: minutesAgo(3),
  endedAt: null,
  failureReason: null,
  justEnded: false,
  ...overrides,
});

const decide = (overrides: Partial<FeedbackViewInput> = {}) =>
  decideFeedbackView(input(overrides), NOW, MAX);

describe("decideFeedbackView: a startable interview opened by hand", () => {
  it("shows the live-call notice, not the room, while a session may still be running", () => {
    expect(decide()).toEqual({ kind: "live-notice" });
  });

  it("waits for the transcript once the room reported the end of the call", () => {
    expect(decide({ endedAt: minutesAgo(1) })).toEqual({ kind: "pending-transcript" });
  });

  it("waits for the transcript once the call must be over, however it ended", () => {
    const pastWindow = minutesAgo(MAX / 60 + RECONCILE_GRACE_SECONDS / 60 + 1);
    expect(decide({ startedAt: pastWindow })).toEqual({ kind: "pending-transcript" });
  });

  it("sends a never-started interview to the room", () => {
    expect(decide({ status: "SCHEDULED", conversationId: null, startedAt: null })).toEqual({ kind: "room" });
  });

  it("sends a silent or lost attempt to the room, where the next start happens", () => {
    expect(decide({ failureReason: "NO_CANDIDATE_TURNS", hasTranscript: true })).toEqual({ kind: "room" });
    expect(decide({ failureReason: "SESSION_LOST" })).toEqual({ kind: "room" });
  });
});

describe("decideFeedbackView: straight from the room", () => {
  it("waits for the transcript", () => {
    expect(decide({ justEnded: true })).toEqual({ kind: "pending-transcript" });
  });

  it("says when the attempt produced nothing to score", () => {
    expect(decide({ justEnded: true, failureReason: "NO_CANDIDATE_TURNS", hasTranscript: true })).toEqual({
      kind: "not-scored",
      reason: "silent",
    });
    expect(decide({ justEnded: true, failureReason: "SESSION_LOST" })).toEqual({
      kind: "not-scored",
      reason: "lost",
    });
  });
});

describe("decideFeedbackView: past the room", () => {
  it.each(["FEEDBACK_PENDING", "GENERATING"] as const)("%s is scoring", (status) => {
    expect(decide({ status, hasTranscript: true })).toEqual({ kind: "pending-scoring" });
  });

  it.each(["FAILED", "EXPIRED"] as const)("%s is failed", (status) => {
    expect(decide({ status })).toEqual({ kind: "failed" });
  });

  it("COMPLETED is the report", () => {
    expect(decide({ status: "COMPLETED", hasTranscript: true })).toEqual({ kind: "report" });
  });
});
