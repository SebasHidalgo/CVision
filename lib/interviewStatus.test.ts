import { describe, expect, it } from "vitest";
import type { InterviewStatus } from "@prisma/client";
import { FEEDBACK_FAILURE_REASONS } from "@/lib/ai/interviewFeedback";
import { CALL_FAILED, SESSION_LOST } from "@/lib/voice/postCall";
import { ABANDONED } from "@/lib/database/interviewExpiry";
import { attemptRan, FAILED_AFTER_ANSWERS } from "./interviewStatus";

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
