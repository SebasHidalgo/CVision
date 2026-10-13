import { after } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import { requireUserId } from "@/lib/auth";
import { fetchInterviewStatus } from "@/lib/database/interview";
import { MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/elevenlabs/agentConfig";
import { RECONCILE_GRACE_SECONDS } from "@/lib/elevenlabs/postCall";
import { reconcileStrandedInterview } from "@/lib/elevenlabs/reconcile";
import { UnauthorizedError } from "@/lib/error/errors";
import { GET } from "./route";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/database/interview", () => ({ fetchInterviewStatus: vi.fn() }));
vi.mock("@/lib/elevenlabs/reconcile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/elevenlabs/reconcile")>();
  return { ...actual, reconcileStrandedInterview: vi.fn() };
});
vi.mock("@/lib/ai/interviewFeedback", () => ({ generateInterviewFeedback: vi.fn() }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn((task: () => unknown) => void task()) };
});

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const WINDOW_MS = (MAX_INTERVIEW_DURATION_SECONDS + RECONCILE_GRACE_SECONDS) * 1000;

const snapshot = (overrides: Partial<NonNullable<Awaited<ReturnType<typeof fetchInterviewStatus>>>> = {}) => ({
  id: INTERVIEW_ID,
  status: "IN_PROGRESS" as const,
  hasFeedback: false,
  startCount: 1,
  failureReason: null,
  conversationId: "conv_1",
  hasTranscript: false,
  startedAt: new Date(),
  ...overrides,
});

async function get() {
  const response = await GET(new Request(`http://localhost/api/interview/${INTERVIEW_ID}/status`), {
    params: Promise.resolve({ id: INTERVIEW_ID }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(fetchInterviewStatus).mockResolvedValue(snapshot());
  vi.mocked(reconcileStrandedInterview).mockResolvedValue({ kind: "not-stranded" });
  vi.mocked(generateInterviewFeedback).mockResolvedValue({ kind: "completed", feedbackId: "fb_1" });
  for (const method of ["info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

describe("GET /api/interview/[id]/status", () => {
  it("answers the four fields the pending page polls for, and nothing else", async () => {
    expect(await get()).toEqual({
      status: 200,
      body: { ok: true, data: { status: "IN_PROGRESS", hasFeedback: false, startCount: 1, failureReason: null } },
    });
  });

  it("answers 401 without a session and 404 for a foreign or missing interview", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect(await get()).toEqual({ status: 401, body: { ok: false, code: "UNAUTHORIZED" } });

    vi.mocked(requireUserId).mockResolvedValue("user_1");
    vi.mocked(fetchInterviewStatus).mockResolvedValue(null);
    expect(await get()).toEqual({ status: 404, body: { ok: false, code: "NOT_FOUND" } });
  });

  it("does not touch the platform while the webhook still has time", async () => {
    await get();
    expect(reconcileStrandedInterview).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("past the window with no transcript, reconciles, triggers feedback once and answers the new status", async () => {
    vi.mocked(fetchInterviewStatus)
      .mockResolvedValueOnce(snapshot({ startedAt: new Date(Date.now() - WINDOW_MS - 1_000) }))
      .mockResolvedValueOnce(snapshot({ status: "FEEDBACK_PENDING", hasTranscript: true }));
    vi.mocked(reconcileStrandedInterview).mockResolvedValue({
      kind: "stored",
      result: { outcome: "stored", interviewId: INTERVIEW_ID, status: "FEEDBACK_PENDING" },
    });

    const { body } = await get();

    expect(reconcileStrandedInterview).toHaveBeenCalledWith(INTERVIEW_ID);
    expect(after).toHaveBeenCalledTimes(1);
    expect(generateInterviewFeedback).toHaveBeenCalledWith(INTERVIEW_ID);
    expect(body).toEqual({
      ok: true,
      data: { status: "FEEDBACK_PENDING", hasFeedback: false, startCount: 1, failureReason: null },
    });
  });

  it("answers the attempts used and the reason when the platform has no record of the session", async () => {
    vi.mocked(fetchInterviewStatus)
      .mockResolvedValueOnce(snapshot({ startedAt: new Date(Date.now() - WINDOW_MS - 1_000) }))
      .mockResolvedValueOnce(snapshot({ failureReason: "SESSION_LOST" }));
    vi.mocked(reconcileStrandedInterview).mockResolvedValue({ kind: "lost" });

    const { body } = await get();

    expect(generateInterviewFeedback).not.toHaveBeenCalled();
    expect(body).toEqual({
      ok: true,
      data: { status: "IN_PROGRESS", hasFeedback: false, startCount: 1, failureReason: "SESSION_LOST" },
    });
  });

  it("still answers the status when the platform fails to answer the reconcile", async () => {
    vi.mocked(fetchInterviewStatus).mockResolvedValue(
      snapshot({ startedAt: new Date(Date.now() - WINDOW_MS - 1_000) }),
    );
    vi.mocked(reconcileStrandedInterview).mockRejectedValue(new Error("ElevenLabs failed (HTTP 503)"));

    expect((await get()).status).toBe(200);
  });
});
