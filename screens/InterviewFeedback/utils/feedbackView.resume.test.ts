import { describe, expect, it } from "vitest";
import { decideFeedbackView, type FeedbackViewInput } from "./feedbackView";

describe("decideFeedbackView: a dropped call and a full house", () => {
  const NOW = new Date("2026-11-11T12:05:00Z");
  const view = (overrides: Partial<FeedbackViewInput>) =>
    decideFeedbackView(
      { status: "IN_PROGRESS", conversationId: "conv_1", hasTranscript: true, startedAt: new Date("2026-11-11T12:00:00Z"), endedAt: new Date("2026-11-11T12:03:12Z"), failureReason: null, justEnded: false, ...overrides },
      NOW,
      720,
    );

  it("sends a resumable interview to the room, where Reconnect and Finish are, even right after the call", () => {
    expect(view({ resumable: true })).toEqual({ kind: "room" });
    expect(view({ resumable: true, justEnded: true })).toEqual({ kind: "room" });
  });

  it("keeps waiting for the record of a call that just ended and is not stored yet", () => {
    expect(view({ resumable: true, hasTranscript: false, justEnded: true })).toEqual({ kind: "pending-transcript" });
  });

  it("says every interviewer was busy, with nothing charged, for a call refused for capacity", () => {
    expect(view({ failureReason: "AT_CAPACITY", justEnded: true, hasTranscript: true })).toEqual({ kind: "not-scored", reason: "busy" });
    expect(view({ failureReason: "AT_CAPACITY" })).toEqual({ kind: "room" });
  });
});
