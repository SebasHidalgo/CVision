import { describe, expect, it } from "vitest";
import type { InterviewStatus } from "@prisma/client";
import { FEEDBACK_FAILURE_REASONS } from "@/lib/ai/interviewFeedback";
import { CALL_FAILED, SESSION_LOST } from "@/lib/voice/postCall";
import { ABANDONED } from "@/lib/database/interviewExpiry";
import { attemptRan, FAILED_AFTER_ANSWERS, interviewStarted, STARTED_INTERVIEW } from "./interviewStatus";

const ran = (status: InterviewStatus, failureReason: string | null = null) => attemptRan({ status, failureReason });

describe("attemptRan", () => {
  it("counts an attempt the candidate answered: waiting for feedback, being scored, or scored", () => {
    expect(ran("FEEDBACK_PENDING")).toBe(true);
    expect(ran("GENERATING")).toBe(true);
    expect(ran("COMPLETED")).toBe(true);
  });

  it("counts a failed attempt only when the scoring failed after the answers", () => {
    expect(ran("FAILED", FEEDBACK_FAILURE_REASONS.feedbackFailed)).toBe(true);
    expect(ran("FAILED", FEEDBACK_FAILURE_REASONS.transcriptInvalid)).toBe(true);
    expect(ran("FAILED", FEEDBACK_FAILURE_REASONS.contextMissing)).toBe(true);
    expect(ran("FAILED", FEEDBACK_FAILURE_REASONS.noCandidateTurns)).toBe(false);
    expect(ran("FAILED", SESSION_LOST)).toBe(false);
    expect(ran("FAILED", CALL_FAILED)).toBe(false);
    expect(ran("FAILED", null)).toBe(false);
  });

  it("never counts an attempt that was not run: scheduled, open, or expired", () => {
    expect(ran("SCHEDULED")).toBe(false);
    expect(ran("IN_PROGRESS")).toBe(false);
    expect(ran("IN_PROGRESS", FEEDBACK_FAILURE_REASONS.noCandidateTurns)).toBe(false);
    expect(ran("EXPIRED", ABANDONED)).toBe(false);
  });

  it("knows every failure the feedback step can write after answers, and only those", () => {
    const afterAnswers = Object.values(FEEDBACK_FAILURE_REASONS).filter((reason) => reason !== FEEDBACK_FAILURE_REASONS.noCandidateTurns);
    expect([...FAILED_AFTER_ANSWERS].sort()).toEqual(afterAnswers.sort());
  });
});

describe("interviewStarted", () => {
  it("is false only for a room still SCHEDULED with no session ever issued", () => {
    expect(interviewStarted({ status: "SCHEDULED", issuedConversationIds: [] })).toBe(false);
  });

  it("is true once a session was issued, even after a failed call gave its start back", () => {
    // CALL_FAILED: startCount back to 0, the unit refunded, the row still IN_PROGRESS with its conversation id.
    expect(interviewStarted({ status: "IN_PROGRESS", issuedConversationIds: ["conv_1"] })).toBe(true);
    expect(interviewStarted({ status: "SCHEDULED", issuedConversationIds: ["conv_1"] })).toBe(true);
  });

  it("is true for every status past SCHEDULED, rows from before the issued-id list included", () => {
    const later: InterviewStatus[] = ["IN_PROGRESS", "FEEDBACK_PENDING", "GENERATING", "COMPLETED", "FAILED", "EXPIRED"];
    for (const status of later) expect(interviewStarted({ status, issuedConversationIds: [] }), status).toBe(true);
  });

  it("has the same meaning as the Prisma filter the lists use", () => {
    expect(STARTED_INTERVIEW).toEqual({ OR: [{ status: { not: "SCHEDULED" } }, { issuedConversationIds: { isEmpty: false } }] });
  });
});
