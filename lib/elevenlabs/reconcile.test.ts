import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimReconcile,
  fetchInterviewForReconcile,
  markSessionLost,
  storeConversationTranscript,
} from "@/lib/database/interviewTranscript";
import { MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/elevenlabs/agentConfig";
import { fetchConversation } from "@/lib/elevenlabs/client";
import { RECONCILE_GRACE_SECONDS, RECONCILE_MIN_INTERVAL_MS, SESSION_LOST } from "@/lib/elevenlabs/postCall";
import { reconcileChangedRow, reconcileNeedsFeedback, reconcileStrandedInterview } from "./reconcile";

vi.mock("@/lib/database/interviewTranscript", () => ({
  claimReconcile: vi.fn(async () => true),
  fetchInterviewForReconcile: vi.fn(),
  markSessionLost: vi.fn(async () => true),
  storeConversationTranscript: vi.fn(),
}));
vi.mock("@/lib/elevenlabs/client", () => ({ fetchConversation: vi.fn() }));

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const NOW = new Date("2026-10-13T12:00:00Z");
const WINDOW_MS = (MAX_INTERVIEW_DURATION_SECONDS + RECONCILE_GRACE_SECONDS) * 1000;

const row = (overrides: Partial<Awaited<ReturnType<typeof fetchInterviewForReconcile>>> = {}) => ({
  id: INTERVIEW_ID,
  status: "IN_PROGRESS" as const,
  conversationId: "conv_1",
  transcriptSource: null,
  startedAt: new Date(NOW.getTime() - WINDOW_MS - 1_000),
  endedAt: null,
  startCount: 1,
  ...overrides,
});

const ended = () => ({
  kind: "ended" as const,
  data: {
    agent_id: "agent_1",
    conversation_id: "conv_1",
    status: "done",
    transcript: [
      { role: "agent", message: "Hi.", time_in_call_secs: 0 },
      { role: "user", message: "Hello.", time_in_call_secs: 3 },
    ],
    metadata: { start_time_unix_secs: 1_760_000_000, call_duration_secs: 200, termination_reason: null },
    conversation_initiation_client_data: null,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimReconcile).mockResolvedValue(true);
  vi.mocked(fetchInterviewForReconcile).mockResolvedValue(row());
  vi.mocked(fetchConversation).mockResolvedValue(ended());
  vi.mocked(storeConversationTranscript).mockResolvedValue({
    outcome: "stored",
    interviewId: INTERVIEW_ID,
    status: "FEEDBACK_PENDING",
  });
  for (const method of ["info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

describe("reconcileStrandedInterview", () => {
  it("does nothing inside the window: the webhook still has time", async () => {
    vi.mocked(fetchInterviewForReconcile).mockResolvedValue(
      row({ startedAt: new Date(NOW.getTime() - WINDOW_MS + 5_000) }),
    );

    expect(await reconcileStrandedInterview(INTERVIEW_ID, NOW)).toEqual({ kind: "not-stranded" });
    expect(fetchConversation).not.toHaveBeenCalled();
  });

  it.each([
    { why: "a transcript is already stored", overrides: { transcriptSource: "elevenlabs" } },
    { why: "the interview is not in progress", overrides: { status: "FEEDBACK_PENDING" as const } },
    { why: "no session was ever issued", overrides: { conversationId: null } },
    { why: "the row is gone", overrides: null },
  ])("does nothing when $why", async ({ overrides }) => {
    vi.mocked(fetchInterviewForReconcile).mockResolvedValue(overrides === null ? null : row(overrides));

    expect(await reconcileStrandedInterview(INTERVIEW_ID, NOW)).toEqual({ kind: "not-stranded" });
    expect(fetchConversation).not.toHaveBeenCalled();
  });

  it("runs two minutes after the room reported the end of a short call, without waiting out the hard limit", async () => {
    vi.mocked(fetchInterviewForReconcile).mockResolvedValue(
      row({
        startedAt: new Date(NOW.getTime() - 5 * 60_000),
        endedAt: new Date(NOW.getTime() - RECONCILE_GRACE_SECONDS * 1000 - 1_000),
      }),
    );

    expect((await reconcileStrandedInterview(INTERVIEW_ID, NOW)).kind).toBe("stored");
    expect(fetchConversation).toHaveBeenCalledWith("conv_1");
  });

  it("past the window, fetches the latest conversation and stores it through the webhook's path, marked as the API's", async () => {
    const outcome = await reconcileStrandedInterview(INTERVIEW_ID, NOW);

    expect(fetchConversation).toHaveBeenCalledWith("conv_1");
    expect(storeConversationTranscript).toHaveBeenCalledWith({
      data: ended().data,
      eventTimestamp: null,
      source: "elevenlabs-api",
    });
    expect(outcome).toEqual({
      kind: "stored",
      result: { outcome: "stored", interviewId: INTERVIEW_ID, status: "FEEDBACK_PENDING" },
    });
    expect(reconcileNeedsFeedback(outcome)).toBe(true);
    expect(markSessionLost).not.toHaveBeenCalled();
  });

  it("leaves a conversation the platform still has open alone, so the poll continues", async () => {
    vi.mocked(fetchConversation).mockResolvedValue({ kind: "in-progress", platformStatus: "processing" });

    const outcome = await reconcileStrandedInterview(INTERVIEW_ID, NOW);

    expect(outcome).toEqual({ kind: "in-progress", platformStatus: "processing" });
    expect(storeConversationTranscript).not.toHaveBeenCalled();
    expect(markSessionLost).not.toHaveBeenCalled();
    expect(reconcileNeedsFeedback(outcome)).toBe(false);
  });

  it("marks a conversation the platform does not know as lost, without consuming the interview", async () => {
    vi.mocked(fetchConversation).mockResolvedValue({ kind: "not-found" });

    const outcome = await reconcileStrandedInterview(INTERVIEW_ID, NOW);

    expect(outcome).toEqual({ kind: "lost" });
    expect(markSessionLost).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      conversationId: "conv_1",
      reason: SESSION_LOST,
    });
    expect(storeConversationTranscript).not.toHaveBeenCalled();
  });

  it("asks the platform at most once a minute: a check that cannot claim the slot fetches nothing", async () => {
    vi.mocked(claimReconcile).mockResolvedValue(false);

    const outcome = await reconcileStrandedInterview(INTERVIEW_ID, NOW);

    expect(outcome).toEqual({ kind: "throttled" });
    expect(claimReconcile).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      now: NOW,
      minIntervalMs: RECONCILE_MIN_INTERVAL_MS,
    });
    expect(fetchConversation).not.toHaveBeenCalled();
    expect(reconcileChangedRow(outcome)).toBe(false);
    expect(reconcileNeedsFeedback(outcome)).toBe(false);
  });

  it("two concurrent checks fetch once: the claim is the race's only winner", async () => {
    vi.mocked(claimReconcile).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const outcomes = await Promise.all([
      reconcileStrandedInterview(INTERVIEW_ID, NOW),
      reconcileStrandedInterview(INTERVIEW_ID, NOW),
    ]);

    expect(fetchConversation).toHaveBeenCalledTimes(1);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["stored", "throttled"]);
  });

  it("does not claim the slot for an interview that is not stranded", async () => {
    vi.mocked(fetchInterviewForReconcile).mockResolvedValue(row({ transcriptSource: "elevenlabs" }));

    await reconcileStrandedInterview(INTERVIEW_ID, NOW);

    expect(claimReconcile).not.toHaveBeenCalled();
  });

  it("reports a silent or duplicate store as not needing feedback", async () => {
    vi.mocked(storeConversationTranscript).mockResolvedValue({
      outcome: "stored",
      interviewId: INTERVIEW_ID,
      status: "IN_PROGRESS",
    });
    expect(reconcileNeedsFeedback(await reconcileStrandedInterview(INTERVIEW_ID, NOW))).toBe(false);

    vi.mocked(storeConversationTranscript).mockResolvedValue({ outcome: "duplicate", interviewId: INTERVIEW_ID });
    expect(reconcileNeedsFeedback(await reconcileStrandedInterview(INTERVIEW_ID, NOW))).toBe(false);
  });
});
