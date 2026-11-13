import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserProfile, requireUserId } from "@/lib/auth";
import {
  fetchInterviewById,
  fetchInterviewCallState,
  reserveInterviewSession,
  type InterviewWithResume,
} from "@/lib/database/interview";
import { expireAbandonedInterviews } from "@/lib/database/interviewExpiry";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { refundUsage, reserveInterview } from "@/lib/database/usage";
import { MAX_INTERVIEW_DURATION_SECONDS, MAX_INTERVIEW_STARTS } from "@/lib/voice/elevenlabs/agentConfig";
import { finalizeResumableInterview } from "@/lib/database/interviewResume";
import { assertVoiceCapacity } from "@/lib/voice/health";
import { InterviewQuotaExceededError, RateLimitedError, UnauthorizedError, VoiceUnavailableError } from "@/lib/error/errors";
import type { InterviewSessionResponse } from "@/types/interview";
import { settlePreviousCall } from "@/lib/voice/reconcile";
import { POST } from "./route";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(), getUserProfile: vi.fn() }));
vi.mock("@/lib/database/interview", () => ({
  fetchInterviewById: vi.fn(),
  fetchInterviewCallState: vi.fn(),
  reserveInterviewSession: vi.fn(),
}));
vi.mock("@/lib/database/interviewResume", () => ({
  finalizeResumableInterview: vi.fn(async () => "finalized"),
  storedCallCounts: (transcript: unknown) =>
    Array.isArray(transcript) && transcript.some((turn: { role?: string; message?: string }) => turn.role === "user" && Boolean(turn.message)),
}));
vi.mock("@/lib/voice/reconcile", () => ({ settlePreviousCall: vi.fn(async () => false) }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/database/usage", () => ({
  reserveInterview: vi.fn(),
  refundUsage: vi.fn(async () => true),
  resolveInterviewEntitlement: vi.fn(async () => ({ maxDurationSeconds: 300 })),
}));
vi.mock("@/lib/database/interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn(async () => 0) }));
vi.mock("@/lib/voice/health", () => ({ assertVoiceCapacity: vi.fn(async () => {}) }));

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const RESUME_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const API_KEY = "test-elevenlabs-key";
const AGENT_ID = "agent_test";
const TRIAL_AGENT_ID = "agent_trial_test";

const feedback = {
  overall: {
    qualityScore: 70,
    summaryText: "Meets the required qualifications; one preferred one is missing.",
    prioritizedFixes: [],
  },
  jobFit: {
    description: "Meets the bar.",
    requirements: [
      { requirement: "React", kind: "required", status: "met", evidence: "React at Northwind", note: "Shown." },
      { requirement: "Payments", kind: "preferred", status: "missing", evidence: "", note: "Nothing on payments." },
    ],
    strategicRecommendations: [],
  },
};

function interview(overrides: Partial<InterviewWithResume> = {}): InterviewWithResume {
  return {
    id: INTERVIEW_ID,
    role: "Frontend Engineer",
    techstack: ["React"],
    userId: "user_1",
    status: "SCHEDULED",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    conversationId: null,
    issuedConversationIds: [],
    contextMismatch: false,
    failureReason: null,
    startedAt: null,
    lastSessionAt: null,
    endedAt: null,
    durationSeconds: null,
    startCount: 0,
    transcriptSource: null,
    feedbackAttempts: 0,
    feedbackStartedAt: null,
    reconcileCheckedAt: null,
    usageEventId: null,
    tier: null,
    paidBy: null,
    language: null,
    resumableUntil: null,
    finishRequestedAt: null,
    callAllowedSeconds: null,
    callEnd: null,
    resumeAnalysisId: RESUME_ID,
    attemptNumber: 1,
    resumeAnalysis: {
      jobDescription: "We are looking for a frontend engineer to own the checkout flow with React.",
      jobTitle: "Frontend Engineer",
      companyName: "Northwind",
      feedback,
    },
    ...overrides,
  };
}

type CallState = NonNullable<Awaited<ReturnType<typeof fetchInterviewCallState>>>;

/** The calls of the interview so far; a first start has none. */
function callState(overrides: Partial<CallState> = {}): CallState {
  return {
    status: "SCHEDULED",
    conversationId: null,
    transcript: null,
    transcriptSource: null,
    segments: null,
    durationSeconds: null,
    endedAt: null,
    lastSessionAt: null,
    resumableUntil: null,
    startCount: 0,
    language: null,
    callEnd: null,
    ...overrides,
  };
}

type Call = { url: URL; headers: Headers };

/** Routes the SDK's HTTP call to `handler`; returns the calls it made. */
function stubElevenLabs(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = { url: new URL(href), headers: new Headers(init?.headers) };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const tokenResponse = () => Response.json({ token: "tok_1", conversation_id: "conv_1" });

async function post(body?: unknown) {
  const response = await POST(
    new Request(`http://localhost/api/interview/${INTERVIEW_ID}/session`, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id: INTERVIEW_ID }) },
  );
  return { status: response.status, body: (await response.json()) as unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ELEVENLABS_API_KEY", API_KEY);
  vi.stubEnv("ELEVENLABS_AGENT_ID", AGENT_ID);
  vi.stubEnv("ELEVENLABS_TRIAL_AGENT_ID", TRIAL_AGENT_ID);
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(getUserProfile).mockResolvedValue({ firstName: "Ana" });
  vi.mocked(fetchInterviewById).mockResolvedValue(interview());
  vi.mocked(fetchInterviewCallState).mockResolvedValue(callState());
  vi.mocked(reserveInterviewSession).mockResolvedValue(true);
  vi.mocked(assertRateLimit).mockResolvedValue(undefined);
  vi.mocked(reserveInterview).mockResolvedValue({ eventId: "evt_1", kind: "INTERVIEW", tier: "FULL", seconds: 720, source: "period" });
  vi.mocked(refundUsage).mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("POST /api/interview/[id]/session: checks before the paid call", () => {
  it("answers 401 without a session, touching nothing", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    const calls = stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 401, body: { ok: false, code: "UNAUTHORIZED" } });
    expect(fetchInterviewById).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("answers 404 for a missing or foreign interview", async () => {
    vi.mocked(fetchInterviewById).mockResolvedValue(null);
    const calls = stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 404, body: { ok: false, code: "NOT_FOUND" } });
    expect(calls).toHaveLength(0);
    expect(reserveInterviewSession).not.toHaveBeenCalled();
  });

  it("answers 409 INTERVIEW_EXPIRED for an expired interview, so the room says it was closed and not charged", async () => {
    vi.mocked(fetchInterviewById).mockResolvedValue(interview({ status: "EXPIRED", startCount: 3, failureReason: "ABANDONED" }));
    const calls = stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 409, body: { ok: false, code: "INTERVIEW_EXPIRED" } });
    expect(calls).toHaveLength(0);
    expect(reserveInterview).not.toHaveBeenCalled();
    expect(reserveInterviewSession).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "FEEDBACK_PENDING", "FAILED"] as const)(
    "answers 409 for a %s interview",
    async (status) => {
      vi.mocked(fetchInterviewById).mockResolvedValue(interview({ status, startCount: 1 }));
      const calls = stubElevenLabs(tokenResponse);

      expect(await post()).toEqual({ status: 409, body: { ok: false, code: "INTERVIEW_NOT_STARTABLE" } });
      expect(calls).toHaveLength(0);
      expect(reserveInterviewSession).not.toHaveBeenCalled();
    },
  );

  it("answers 409 at the start cap", async () => {
    vi.mocked(fetchInterviewById).mockResolvedValue(
      interview({ status: "IN_PROGRESS", startCount: MAX_INTERVIEW_STARTS }),
    );
    const calls = stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 409, body: { ok: false, code: "INTERVIEW_START_LIMIT" } });
    expect(calls).toHaveLength(0);
    expect(reserveInterviewSession).not.toHaveBeenCalled();
  });

  it("answers 409 when the analysis has no feedback to brief the interviewer with", async () => {
    vi.mocked(fetchInterviewById).mockResolvedValue(
      interview({ resumeAnalysis: { ...interview().resumeAnalysis!, feedback: null } }),
    );
    const calls = stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 409, body: { ok: false, code: "INTERVIEW_CONTEXT_MISSING" } });
    expect(calls).toHaveLength(0);
  });

  it("answers 500 VOICE_MISCONFIGURED without calling out when the key is missing", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const calls = stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 500, body: { ok: false, code: "VOICE_MISCONFIGURED" } });
    expect(calls).toHaveLength(0);
    expect(reserveInterviewSession).not.toHaveBeenCalled();
  });

  it("answers 503 VOICE_UNAVAILABLE when the platform's balance is below the floor, before reserving anything, issuing anything or counting a start", async () => {
    vi.mocked(assertVoiceCapacity).mockRejectedValueOnce(new VoiceUnavailableError("balance below the floor"));
    const calls = stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 503, body: { ok: false, code: "VOICE_UNAVAILABLE" } });
    expect(calls).toHaveLength(0);
    expect(reserveInterview).not.toHaveBeenCalled();
    expect(reserveInterviewSession).not.toHaveBeenCalled();
    expect(refundUsage).not.toHaveBeenCalled();
    // After the ownership, state and context checks: a 404 or a 409 never reads the balance.
    expect(assertVoiceCapacity).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchInterviewById).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(assertVoiceCapacity).mock.invocationCallOrder[0]);
  });

  it("sizes the balance floor on the agent: the entitlement's for a first start, the interview's tier for a reconnect", async () => {
    stubElevenLabs(tokenResponse);
    await post();
    expect(assertVoiceCapacity).toHaveBeenLastCalledWith(300);

    vi.mocked(fetchInterviewById).mockResolvedValue(interview({ status: "IN_PROGRESS", startCount: 1, conversationId: "conv_0", usageEventId: "evt_0", tier: "FULL", paidBy: "PERIOD" }));
    stubElevenLabs(tokenResponse);
    await post();
    expect(assertVoiceCapacity).toHaveBeenLastCalledWith(720);
  });

  it("does not read the balance for an interview it refuses on state", async () => {
    vi.mocked(fetchInterviewById).mockResolvedValue(interview({ status: "COMPLETED", startCount: 1 }));
    stubElevenLabs(tokenResponse);

    expect((await post()).status).toBe(409);
    expect(assertVoiceCapacity).not.toHaveBeenCalled();
  });
});

describe("POST /api/interview/[id]/session: happy path", () => {
  it("issues a token, stores the issued context and counts the start", async () => {
    const calls = stubElevenLabs(tokenResponse);

    const { status, body } = await post();

    expect(status).toBe(200);
    const result = body as { ok: true; data: InterviewSessionResponse };
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      connectionType: "webrtc",
      conversationToken: "tok_1",
      conversationId: "conv_1",
      language: "en",
      maxDurationSeconds: MAX_INTERVIEW_DURATION_SECONDS,
      source: "period",
    });
    expect(result.data.dynamicVariables.interview_id).toBe(INTERVIEW_ID);
    expect(result.data.dynamicVariables.candidate_name).toBe("Ana");
    expect(result.data.dynamicVariables.interview_minutes).toBe("12");
    expect(result.data.dynamicVariables).not.toHaveProperty("gaps_to_cover");
    expect(result.data.dynamicVariables.requirements_gaps).toContain("Payments");
    expect(new Date(result.data.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // The paid platform saw one call, for our agent, with the key in a header
    // the browser never sees.
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/v1/convai/conversation/token");
    expect(calls[0].url.searchParams.get("agent_id")).toBe(AGENT_ID);
    expect(calls[0].headers.get("xi-api-key")).toBe(API_KEY);

    // The first token took the plan's unit, in this request, before the token.
    expect(reserveInterview).toHaveBeenCalledWith("user_1", INTERVIEW_ID);
    expect(vi.mocked(reserveInterview).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(reserveInterviewSession).mock.invocationCallOrder[0],
    );
    expect(reserveInterviewSession).toHaveBeenCalledTimes(1);
    expect(reserveInterviewSession).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      issuedContext: result.data.dynamicVariables,
      conversationId: "conv_1",
      startedAt: expect.any(Date),
      issuedAt: expect.any(Date),
      maxStarts: MAX_INTERVIEW_STARTS,
      language: "en",
      allowedSeconds: 720,
      reservation: { usageEventId: "evt_1", tier: "FULL", paidBy: "PERIOD" },
    });
    // The abandoned-interview sweep ran for this user before the row was read.
    expect(expireAbandonedInterviews).toHaveBeenCalledWith("user_1");
    expect(refundUsage).not.toHaveBeenCalled();
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "interviewStart");
  });

  it("allows a retry of a dropped call: in progress, below the cap, on the tier the first token set, reserving nothing", async () => {
    const startedAt = new Date("2026-10-09T10:00:00Z");
    vi.mocked(fetchInterviewById).mockResolvedValue(
      interview({ status: "IN_PROGRESS", startCount: 1, startedAt, conversationId: "conv_0", usageEventId: "evt_0", tier: "TRIAL", paidBy: "TRIAL" }),
    );
    const calls = stubElevenLabs(tokenResponse);

    const { status, body } = await post();

    expect(status).toBe(200);
    expect(reserveInterview).not.toHaveBeenCalled();
    expect(reserveInterviewSession).toHaveBeenCalledWith(expect.objectContaining({ startedAt }));
    expect(vi.mocked(reserveInterviewSession).mock.calls[0][0]).not.toHaveProperty("reservation");
    expect((body as { data: InterviewSessionResponse }).data.maxDurationSeconds).toBe(300);
    expect((body as { data: InterviewSessionResponse }).data.source).toBe("trial");
    expect(calls[0].url.searchParams.get("agent_id")).toBe(TRIAL_AGENT_ID);
  });

  it("runs a credit on the main agent for twelve minutes and records the credit as what paid, so the room and the ledger agree", async () => {
    vi.mocked(reserveInterview).mockResolvedValue({ eventId: "evt_c", kind: "INTERVIEW_CREDIT", tier: "FULL", seconds: 720, source: "credit" });
    const calls = stubElevenLabs(tokenResponse);

    const { body } = await post();
    const { data } = body as { data: InterviewSessionResponse };

    expect(calls[0].url.searchParams.get("agent_id")).toBe(AGENT_ID);
    expect(data.maxDurationSeconds).toBe(720);
    expect(data.source).toBe("credit");
    expect(data.dynamicVariables.interview_minutes).toBe("12");
    expect(reserveInterviewSession).toHaveBeenCalledWith(expect.objectContaining({ reservation: { usageEventId: "evt_c", tier: "FULL", paidBy: "CREDIT" } }));
  });

  it("runs a Free account's first token on the trial agent, five minutes, and tells the interviewer so", async () => {
    vi.mocked(reserveInterview).mockResolvedValue({ eventId: "evt_t", kind: "INTERVIEW_TRIAL", tier: "TRIAL", seconds: 300, source: "trial" });
    const calls = stubElevenLabs(tokenResponse);

    const { body } = await post();
    const { data } = body as { data: InterviewSessionResponse };

    expect(calls[0].url.searchParams.get("agent_id")).toBe(TRIAL_AGENT_ID);
    expect(data.maxDurationSeconds).toBe(300);
    expect(data.dynamicVariables.interview_minutes).toBe("5");
    // The trial gets the same pool as the full interview: the gap and the strength.
    expect(data.dynamicVariables.requirements_gaps).toContain("Payments");
    expect(data.dynamicVariables.requirements_met).toContain("React");
    expect(reserveInterviewSession).toHaveBeenCalledWith(expect.objectContaining({ reservation: { usageEventId: "evt_t", tier: "TRIAL", paidBy: "TRIAL" } }));
  });

  it("refuses a trial when its agent is not configured, and gives the unit back", async () => {
    vi.stubEnv("ELEVENLABS_TRIAL_AGENT_ID", "");
    vi.mocked(reserveInterview).mockResolvedValue({ eventId: "evt_t", kind: "INTERVIEW_TRIAL", tier: "TRIAL", seconds: 300, source: "trial" });
    const calls = stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 500, body: { ok: false, code: "VOICE_MISCONFIGURED" } });
    expect(calls).toHaveLength(0);
    expect(refundUsage).toHaveBeenCalledWith("evt_t", "VOICE_MISCONFIGURED");
  });

  it("answers 403 with the plan when the quota refuses, before any paid call", async () => {
    vi.mocked(reserveInterview).mockRejectedValue(new InterviewQuotaExceededError({ plan: "FREE" }));
    const calls = stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 403, body: { ok: false, code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } } });
    expect(calls).toHaveLength(0);
    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After when the hourly start limit is hit", async () => {
    vi.mocked(assertRateLimit).mockRejectedValue(new RateLimitedError(900));

    const response = await POST(new Request(`http://localhost/api/interview/${INTERVIEW_ID}/session`, { method: "POST" }), {
      params: Promise.resolve({ id: INTERVIEW_ID }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("900");
    expect(fetchInterviewById).not.toHaveBeenCalled();
  });

  it("answers 409 and gives the unit back when the guarded write finds the interview changed under it", async () => {
    vi.mocked(reserveInterviewSession).mockResolvedValue(false);
    stubElevenLabs(tokenResponse);

    expect(await post()).toEqual({ status: 409, body: { ok: false, code: "INTERVIEW_NOT_STARTABLE" } });
    expect(refundUsage).toHaveBeenCalledWith("evt_1", "INTERVIEW_NOT_STARTABLE");
  });
});

describe("POST /api/interview/[id]/session: the platform fails", () => {
  it.each([
    { when: "ElevenLabs is down", respond: () => Response.json({ detail: "down" }, { status: 503 }), status: 503, code: "VOICE_UNAVAILABLE" },
    { when: "ElevenLabs is rate limiting", respond: () => Response.json({ detail: "slow" }, { status: 429 }), status: 503, code: "VOICE_UNAVAILABLE" },
    { when: "the key is rejected", respond: () => Response.json({ detail: "nope" }, { status: 401 }), status: 503, code: "VOICE_KEY_REJECTED" },
    { when: "the agent id is unknown", respond: () => Response.json({ detail: "nope" }, { status: 422 }), status: 500, code: "VOICE_MISCONFIGURED" },
    {
      when: "nothing is listening",
      respond: () => {
        throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
      },
      status: 503,
      code: "VOICE_UNAVAILABLE",
    },
  ])("answers $status $code when $when, records no start and gives the unit back", async ({ respond, status, code }) => {
    stubElevenLabs(respond);

    expect(await post()).toEqual({ status, body: { ok: false, code } });
    expect(reserveInterviewSession).not.toHaveBeenCalled();
    expect(refundUsage).toHaveBeenCalledWith("evt_1", code);
  });
});

describe("POST /api/interview/[id]/session: the language of the call", () => {
  it("proposes the posting's language and stores it", async () => {
    stubElevenLabs(tokenResponse);
    const { body } = await post();
    expect((body as { data: InterviewSessionResponse }).data.language).toBe("en");
    expect(vi.mocked(reserveInterviewSession).mock.calls[0][0]).toMatchObject({ language: "en" });
  });

  it("speaks the language the room chose, whatever the posting's", async () => {
    stubElevenLabs(tokenResponse);
    const { body } = await post({ language: "es" });
    const data = (body as { data: InterviewSessionResponse }).data;
    expect(data.language).toBe("es");
    expect(data.dynamicVariables.language_name).toBe("Spanish");
    expect(data.dynamicVariables.opening_line).toContain("Hola Ana");
    expect(vi.mocked(reserveInterviewSession).mock.calls[0][0]).toMatchObject({ language: "es" });
  });

  it("keeps the interview's language on a later start that names none", async () => {
    stubElevenLabs(tokenResponse);
    vi.mocked(fetchInterviewCallState).mockResolvedValue(callState({ language: "es" }));
    const { body } = await post();
    expect((body as { data: InterviewSessionResponse }).data.language).toBe("es");
  });

  it("refuses a language the agent does not speak", async () => {
    const calls = stubElevenLabs(tokenResponse);
    expect(await post({ language: "fr" })).toEqual({ status: 400, body: { ok: false, code: "INVALID_INPUT" } });
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/interview/[id]/session: a reconnect continues the interview", () => {
  const dropped = (overrides: Partial<CallState> = {}) =>
    callState({
      status: "IN_PROGRESS",
      conversationId: "conv_0",
      transcriptSource: "elevenlabs",
      transcript: [
        { role: "agent", message: "Hi Ana. Tell me about a checkout flow you owned?", time_in_call_secs: 0 },
        { role: "user", message: "I rebuilt the cart at Northwind.", time_in_call_secs: 9 },
      ],
      durationSeconds: 192,
      endedAt: new Date("2026-11-11T12:03:12Z"),
      lastSessionAt: new Date("2026-11-11T12:00:00Z"),
      resumableUntil: new Date("2026-11-11T12:13:12Z"),
      startCount: 1,
      ...overrides,
    });

  beforeEach(() => {
    vi.mocked(fetchInterviewById).mockResolvedValue(interview({ status: "IN_PROGRESS", startCount: 1, usageEventId: "evt_1", tier: "FULL", paidBy: "PERIOD" }));
  });

  it("takes no new unit, gives the time left and tells the interviewer what was asked", async () => {
    stubElevenLabs(tokenResponse);
    vi.mocked(fetchInterviewCallState).mockResolvedValue(dropped());

    const { status, body } = await post();
    const data = (body as { data: InterviewSessionResponse }).data;

    expect(status).toBe(200);
    expect(reserveInterview).not.toHaveBeenCalled();
    expect(data.resumed).toBe(true);
    expect(data.maxDurationSeconds).toBe(720 - 192);
    // 8:48 left is planned as 8 minutes and said as "about 8 and a half": rounded down, never up.
    expect(data.dynamicVariables.interview_minutes).toBe("8");
    expect(data.dynamicVariables.opening_line).toBe("Welcome back, Ana. Let's pick up where we left off. We have about 8 and a half minutes left.");
    expect(data.dynamicVariables.call_context).toContain("1. You asked: Hi Ana. Tell me about a checkout flow you owned?\n   The candidate answered: I rebuilt the cart at Northwind.");
    expect(data.dynamicVariables.call_context).not.toContain("PENDING QUESTION");
    const write = vi.mocked(reserveInterviewSession).mock.calls[0][0];
    // What the resumed call may run, for the overrun check.
    expect(write.allowedSeconds).toBe(720 - 192);
    expect(write.carry?.fromConversationId).toBe("conv_0");
    expect(write.carry?.segments).toHaveLength(1);
    expect(write.carry?.segments[0]).toMatchObject({ conversationId: "conv_0", durationSeconds: 192 });
  });

  it("asks first the question the drop left without an answer", async () => {
    stubElevenLabs(tokenResponse);
    vi.mocked(fetchInterviewCallState).mockResolvedValue(
      dropped({
        transcript: [
          { role: "agent", message: "Hi Ana. Tell me about a checkout flow you owned?", time_in_call_secs: 0 },
          { role: "user", message: "I rebuilt the cart at Northwind.", time_in_call_secs: 9 },
          { role: "agent", message: "Thanks. How did you test it before it shipped?", time_in_call_secs: 30 },
        ],
      }),
    );

    const { body } = await post();
    const context = (body as { data: InterviewSessionResponse }).data.dynamicVariables.call_context;
    expect(context).toContain("Your first question is the one under PENDING QUESTION below");
    expect(context).toContain("PENDING QUESTION (asked just before the drop, never answered)\nThanks. How did you test it before it shipped?");
    expect(context.split("PENDING QUESTION (asked")[0]).not.toContain("How did you test it");
  });

  it("fetches the record of a previous call that has not arrived before it reads the interview or reserves", async () => {
    stubElevenLabs(tokenResponse);
    const unrecorded = dropped({ transcript: null, transcriptSource: null, durationSeconds: null, endedAt: null });
    vi.mocked(fetchInterviewCallState).mockResolvedValueOnce(unrecorded).mockResolvedValue(dropped());

    const { body } = await post();

    expect(settlePreviousCall).toHaveBeenCalledWith(INTERVIEW_ID, unrecorded, { unthrottled: true, patient: true });
    expect(vi.mocked(settlePreviousCall).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetchInterviewById).mock.invocationCallOrder[0]);
    // The time left comes from the record the fetch stored, not from the server's clock.
    expect((body as { data: InterviewSessionResponse }).data.maxDurationSeconds).toBe(720 - 192);
  });

  it("reserves again when the fetched record shows nobody spoke: the dropped call released its unit", async () => {
    stubElevenLabs(tokenResponse);
    // Before the fetch the row still holds the unit; the read after it sees the unit released.
    vi.mocked(fetchInterviewById).mockResolvedValue(interview({ status: "IN_PROGRESS", startCount: 1, usageEventId: null, tier: "FULL", paidBy: "PERIOD" }));
    vi.mocked(fetchInterviewCallState)
      .mockResolvedValueOnce(dropped({ transcript: null, transcriptSource: null, durationSeconds: null }))
      .mockResolvedValue(dropped({ transcript: [{ role: "agent", message: "Hi Ana.", time_in_call_secs: 0 }], durationSeconds: 40, resumableUntil: null }));
    vi.mocked(settlePreviousCall).mockResolvedValueOnce(true);

    const { body } = await post();
    const data = (body as { data: InterviewSessionResponse }).data;
    expect(reserveInterview).toHaveBeenCalledTimes(1);
    expect(data.resumed).toBe(false);
    expect(data.maxDurationSeconds).toBe(720);
    expect(vi.mocked(reserveInterviewSession).mock.calls[0][0]).toMatchObject({ allowedSeconds: 720, reservation: { usageEventId: "evt_1" } });
  });

  it("adds the stored call to the earlier ones on a second reconnect", async () => {
    stubElevenLabs(tokenResponse);
    const first = { conversationId: "conv_a", turns: [{ role: "user", message: "First answer.", time_in_call_secs: 2 }], durationSeconds: 100, startTimeSeconds: 1 };
    vi.mocked(fetchInterviewById).mockResolvedValue(interview({ status: "IN_PROGRESS", startCount: 2, usageEventId: "evt_1", tier: "FULL", paidBy: "PERIOD" }));
    vi.mocked(fetchInterviewCallState).mockResolvedValue(dropped({ segments: [first], startCount: 2 }));

    const { body } = await post();
    expect((body as { data: InterviewSessionResponse }).data.maxDurationSeconds).toBe(720 - 100 - 192);
    expect(vi.mocked(reserveInterviewSession).mock.calls[0][0].carry?.segments.map((segment) => segment.conversationId)).toEqual(["conv_a", "conv_0"]);
  });

  it("scores the interview instead of starting a call when its time is used up", async () => {
    const calls = stubElevenLabs(tokenResponse);
    vi.mocked(fetchInterviewCallState).mockResolvedValue(dropped({ durationSeconds: 700 }));

    expect(await post()).toEqual({ status: 409, body: { ok: false, code: "INTERVIEW_NOT_STARTABLE" } });
    expect(finalizeResumableInterview).toHaveBeenCalledWith(INTERVIEW_ID);
    expect(calls).toHaveLength(0);
    expect(reserveInterviewSession).not.toHaveBeenCalled();
  });

  it("starts fresh after a call in which nobody spoke", async () => {
    stubElevenLabs(tokenResponse);
    vi.mocked(fetchInterviewById).mockResolvedValue(interview({ status: "IN_PROGRESS", startCount: 1 }));
    vi.mocked(fetchInterviewCallState).mockResolvedValue(
      dropped({ transcript: [{ role: "agent", message: "Hi Ana.", time_in_call_secs: 0 }], durationSeconds: 5, resumableUntil: null }),
    );

    const { body } = await post();
    const data = (body as { data: InterviewSessionResponse }).data;
    expect(reserveInterview).toHaveBeenCalledTimes(1);
    expect(data.resumed).toBe(false);
    expect(data.maxDurationSeconds).toBe(720);
    expect(vi.mocked(reserveInterviewSession).mock.calls[0][0].carry).toBeUndefined();
  });
});
