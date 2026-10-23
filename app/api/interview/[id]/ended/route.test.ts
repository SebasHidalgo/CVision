import { after } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import { requireUserId } from "@/lib/auth";
import { markInterviewEnded } from "@/lib/database/interview";
import { EARLY_END_WINDOW_MS } from "@/lib/elevenlabs/postCall";
import { reconcileStrandedInterview } from "@/lib/elevenlabs/reconcile";
import { UnauthorizedError } from "@/lib/error/errors";
import { POST } from "./route";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/database/interview", () => ({ markInterviewEnded: vi.fn() }));
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

async function post(body: BodyInit | null, contentType = "application/json") {
  const response = await POST(
    new Request(`http://localhost/api/interview/${INTERVIEW_ID}/ended`, {
      method: "POST",
      headers: body === null ? {} : { "content-type": contentType },
      body,
    }),
    { params: Promise.resolve({ id: INTERVIEW_ID }) },
  );
  return { status: response.status, body: (await response.json()) as unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(markInterviewEnded).mockResolvedValue({ recorded: true, sessionAgeMs: 5 * 60_000 });
  vi.mocked(reconcileStrandedInterview).mockResolvedValue({ kind: "throttled" });
  vi.mocked(generateInterviewFeedback).mockResolvedValue({ kind: "completed", interviewId: INTERVIEW_ID } as never);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/interview/[id]/ended", () => {
  it("records the end of the call once, with the SDK's reason in the log only", async () => {
    expect(await post(JSON.stringify({ reason: "agent" }))).toEqual({
      status: 200,
      body: { ok: true, data: { recorded: true } },
    });
    expect(markInterviewEnded).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      endedAt: new Date("2026-10-13T12:00:00Z"),
    });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("reason=agent recorded=true"));
    // Five minutes into a call is an ordinary end: the webhook gets its grace.
    expect(after).not.toHaveBeenCalled();
    expect(reconcileStrandedInterview).not.toHaveBeenCalled();
  });

  it("answers recorded=false when there was nothing to write, as for a second report", async () => {
    vi.mocked(markInterviewEnded).mockResolvedValue({ recorded: false });

    expect(await post(JSON.stringify({ reason: "user" }))).toEqual({
      status: 200,
      body: { ok: true, data: { recorded: false } },
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("fetches the conversation at once, after the response, when the call ended within seconds of its session: no webhook comes for a call the platform refused", async () => {
    vi.mocked(markInterviewEnded).mockResolvedValue({ recorded: true, sessionAgeMs: EARLY_END_WINDOW_MS });
    vi.mocked(reconcileStrandedInterview).mockResolvedValue({ kind: "stored", result: { outcome: "stored", interviewId: INTERVIEW_ID, status: "IN_PROGRESS" } });

    expect((await post(JSON.stringify({ reason: "agent" }))).status).toBe(200);

    expect(after).toHaveBeenCalledTimes(1);
    expect(reconcileStrandedInterview).toHaveBeenCalledWith(INTERVIEW_ID, new Date("2026-10-13T12:00:00Z"), { graceSeconds: 0 });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("early (30 s after the session): fetching the conversation now"));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("early reconcile interview=" + INTERVIEW_ID + ": stored"));
    // Nothing to score: the platform failed the call, so no feedback is generated.
    expect(generateInterviewFeedback).not.toHaveBeenCalled();
  });

  it("scores a short call the candidate did answer, when the early fetch brought a transcript with turns", async () => {
    vi.mocked(markInterviewEnded).mockResolvedValue({ recorded: true, sessionAgeMs: 12_000 });
    vi.mocked(reconcileStrandedInterview).mockResolvedValue({ kind: "stored", result: { outcome: "stored", interviewId: INTERVIEW_ID, status: "FEEDBACK_PENDING" } });

    await post(JSON.stringify({ reason: "user" }));

    expect(generateInterviewFeedback).toHaveBeenCalledWith(INTERVIEW_ID);
  });

  it("leaves the grace path alone one millisecond past the window, and when the row does not know when the session was issued", async () => {
    vi.mocked(markInterviewEnded).mockResolvedValue({ recorded: true, sessionAgeMs: EARLY_END_WINDOW_MS + 1 });
    await post(JSON.stringify({ reason: "agent" }));
    vi.mocked(markInterviewEnded).mockResolvedValue({ recorded: true, sessionAgeMs: null });
    await post(JSON.stringify({ reason: "agent" }));

    expect(after).not.toHaveBeenCalled();
  });

  it("survives an early fetch that throws: the status poll retries a minute later", async () => {
    vi.mocked(markInterviewEnded).mockResolvedValue({ recorded: true, sessionAgeMs: 1_000 });
    vi.mocked(reconcileStrandedInterview).mockRejectedValue(new Error("platform down"));

    expect((await post(JSON.stringify({ reason: "agent" }))).status).toBe(200);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("early reconcile interview="), expect.any(Error));
  });

  it("tolerates an empty or non-JSON body: the reason is for the log", async () => {
    expect((await post(null)).status).toBe(200);
    expect((await post("not json", "text/plain")).status).toBe(200);
    expect(markInterviewEnded).toHaveBeenCalledTimes(2);
  });

  it("rejects a reason that is not a short string, and a signed-out caller", async () => {
    expect((await post(JSON.stringify({ reason: "x".repeat(41) }))).status).toBe(400);
    expect(markInterviewEnded).not.toHaveBeenCalled();

    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect(await post(JSON.stringify({ reason: "user" }))).toEqual({
      status: 401,
      body: { ok: false, code: "UNAUTHORIZED" },
    });
  });
});
