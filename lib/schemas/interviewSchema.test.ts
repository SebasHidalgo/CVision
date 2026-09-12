import { describe, expect, it } from "vitest";
import {
  isTranscriptTooLong,
  MAX_TRANSCRIPT_MESSAGES,
  submitInterviewFeedbackInputSchema,
  techstackSchema,
} from "./interviewSchema";

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

const message = (length: number, role: "user" | "assistant" = "user") => ({
  role,
  content: "x".repeat(length),
});

/** How the feedback action classifies this input. */
function outcome(input: Record<string, unknown>) {
  const result = submitInterviewFeedbackInputSchema.safeParse({
    interviewId: INTERVIEW_ID,
    ...input,
  });
  if (result.success) return "ok";
  return isTranscriptTooLong(result.error) ? "too long" : "invalid";
}

describe("transcript: size caps", () => {
  it("accepts a realistic interview (about 11,000 characters)", () => {
    const transcript = Array.from({ length: 40 }, (_, i) =>
      message(275, i % 2 ? "user" : "assistant"),
    );
    expect(outcome({ transcript })).toBe("ok");
  });

  it("accepts exactly 60,000 characters in total", () => {
    expect(outcome({ transcript: Array(30).fill(message(2_000)) })).toBe("ok");
  });

  it("rejects 60,001 characters in total as too long", () => {
    const transcript = [...Array(30).fill(message(2_000)), message(1)];
    expect(outcome({ transcript })).toBe("too long");
  });

  it("accepts a message of exactly 2,000 characters", () => {
    expect(outcome({ transcript: [message(2_000)] })).toBe("ok");
  });

  it("rejects a message of 2,001 characters as too long", () => {
    expect(outcome({ transcript: [message(2_001)] })).toBe("too long");
  });

  it(`accepts ${MAX_TRANSCRIPT_MESSAGES} messages`, () => {
    expect(outcome({ transcript: Array(MAX_TRANSCRIPT_MESSAGES).fill(message(1)) })).toBe("ok");
  });

  it(`rejects ${MAX_TRANSCRIPT_MESSAGES + 1} messages as too long`, () => {
    const transcript = Array(MAX_TRANSCRIPT_MESSAGES + 1).fill(message(1));
    expect(outcome({ transcript })).toBe("too long");
  });
});

describe("transcript: other failures are not reported as too long", () => {
  it("rejects an empty transcript as invalid", () => {
    expect(outcome({ transcript: [] })).toBe("invalid");
  });

  it("rejects an interview id that is not a UUID as invalid", () => {
    expect(outcome({ interviewId: "not-a-uuid", transcript: [message(10)] })).toBe("invalid");
  });

  it("rejects an unknown speaker role as invalid", () => {
    expect(outcome({ transcript: [{ role: "candidate", content: "hi" }] })).toBe("invalid");
  });

  it("rejects a recording URL that is not a URL as invalid", () => {
    expect(outcome({ transcript: [message(10)], recordingUrl: "not a url" })).toBe("invalid");
  });
});

describe("techstackSchema", () => {
  const accepts = (value: unknown) => techstackSchema.safeParse(value).success;

  it("accepts up to 30 entries of 1-60 characters", () => {
    expect(accepts(Array(30).fill("TypeScript"))).toBe(true);
    expect(accepts(["x".repeat(60)])).toBe(true);
    expect(accepts([])).toBe(true);
  });

  it("rejects more than 30 entries", () => {
    expect(accepts(Array(31).fill("TypeScript"))).toBe(false);
  });

  it("rejects empty and over-long entries", () => {
    expect(accepts([""])).toBe(false);
    expect(accepts(["x".repeat(61)])).toBe(false);
  });
});
