import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import { fetchInterviewById, storeClientTranscript, type InterviewWithResume } from "@/lib/database/interview";
import { submitInterviewFeedbackAction } from "./submitInterviewFeedbackAction";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "user_1") }));
vi.mock("@/lib/database/interview", () => ({
  fetchInterviewById: vi.fn(),
  storeClientTranscript: vi.fn(async () => true),
}));
vi.mock("@/lib/ai/interviewFeedback", () => ({
  generateInterviewFeedback: vi.fn(),
  FEEDBACK_FAILURE_REASONS: {
    noCandidateTurns: "NO_CANDIDATE_TURNS",
    transcriptInvalid: "TRANSCRIPT_INVALID",
    contextMissing: "CONTEXT_MISSING",
    feedbackFailed: "FEEDBACK_FAILED",
  },
}));

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

const interview = (status: InterviewWithResume["status"]) =>
  ({ id: INTERVIEW_ID, status }) as unknown as InterviewWithResume;

const TRANSCRIPT = [
  { role: "system" as const, content: "call started" },
  { role: "assistant" as const, content: "Hi, tell me about yourself." },
  { role: "user" as const, content: "I build web apps." },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchInterviewById).mockResolvedValue(interview("IN_PROGRESS"));
  vi.mocked(storeClientTranscript).mockResolvedValue(true);
  vi.mocked(generateInterviewFeedback).mockResolvedValue({ kind: "completed", feedbackId: "feedback_1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("submitInterviewFeedbackAction (legacy)", () => {
  it("stores the browser transcript as turns, marked as the client's, then runs the generator", async () => {
    const result = await submitInterviewFeedbackAction({ interviewId: INTERVIEW_ID, transcript: TRANSCRIPT });

    expect(result).toEqual({ ok: true, data: { feedbackId: "feedback_1" } });
    expect(storeClientTranscript).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      turns: [
        { role: "agent", message: "Hi, tell me about yourself.", time_in_call_secs: null },
        { role: "user", message: "I build web apps.", time_in_call_secs: null },
      ],
      recordingUrl: undefined,
    });
    expect(generateInterviewFeedback).toHaveBeenCalledWith(INTERVIEW_ID);
  });

  it("answers ok with no id when another generator already holds the row", async () => {
    vi.mocked(generateInterviewFeedback).mockResolvedValue({ kind: "skipped" });

    expect(await submitInterviewFeedbackAction({ interviewId: INTERVIEW_ID, transcript: TRANSCRIPT })).toEqual({
      ok: true,
      data: { feedbackId: null },
    });
  });

  it.each([
    ["COMPLETED", "INTERVIEW_ALREADY_SCORED"],
    ["FEEDBACK_PENDING", "INTERVIEW_ALREADY_SCORED"],
    ["FAILED", "INTERVIEW_NOT_STARTABLE"],
  ] as const)("refuses a %s interview with %s, storing nothing", async (status, code) => {
    vi.mocked(fetchInterviewById).mockResolvedValue(interview(status));

    expect(await submitInterviewFeedbackAction({ interviewId: INTERVIEW_ID, transcript: TRANSCRIPT })).toEqual({
      ok: false,
      code,
    });
    expect(storeClientTranscript).not.toHaveBeenCalled();
    expect(generateInterviewFeedback).not.toHaveBeenCalled();
  });

  it("surfaces a provider failure as its code, and a silent transcript as TRANSCRIPT_EMPTY", async () => {
    vi.mocked(generateInterviewFeedback).mockResolvedValue({ kind: "retry-later", code: "AI_UNAVAILABLE" });
    expect(await submitInterviewFeedbackAction({ interviewId: INTERVIEW_ID, transcript: TRANSCRIPT })).toEqual({
      ok: false,
      code: "AI_UNAVAILABLE",
    });

    vi.mocked(generateInterviewFeedback).mockResolvedValue({ kind: "failed", reason: "NO_CANDIDATE_TURNS" });
    expect(await submitInterviewFeedbackAction({ interviewId: INTERVIEW_ID, transcript: TRANSCRIPT })).toEqual({
      ok: false,
      code: "TRANSCRIPT_EMPTY",
    });
  });

  it("rejects an empty transcript before touching anything", async () => {
    expect(await submitInterviewFeedbackAction({ interviewId: INTERVIEW_ID, transcript: [] })).toEqual({
      ok: false,
      code: "TRANSCRIPT_EMPTY",
    });
    expect(fetchInterviewById).not.toHaveBeenCalled();
  });
});
