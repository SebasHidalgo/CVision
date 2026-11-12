import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { fromConversationApi, toCallRecord, type PostCallTranscription } from "@/lib/voice/elevenlabs/wire";
import { claimReconcile, markSessionLost, storeConversationTranscript } from "./interviewTranscript";
import { refundUsageIn } from "./usage";

/** The transaction the refund and the forgotten reservation share. */
const tx = { interview: { updateMany: vi.fn(async () => ({ count: 1 })) } };
vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    interview: { findFirst: vi.fn(), updateMany: vi.fn() },
    user: { updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(async () => ({ callOverruns: 2 })) },
  },
}));
vi.mock("./usage", () => ({ refundUsageIn: vi.fn(async () => true) }));

const findFirst = vi.mocked(prisma.interview.findFirst);
const updateMany = vi.mocked(prisma.interview.updateMany);

const payload = (overrides: Partial<PostCallTranscription> = {}): PostCallTranscription => ({
  agent_id: "agent_1",
  conversation_id: "conv_2",
  status: "done",
  transcript: [
    { role: "agent", message: "Hi.", time_in_call_secs: 0 },
    { role: "user", message: "Hello.", time_in_call_secs: 3 },
  ],
  metadata: { start_time_unix_secs: 1_760_000_000, call_duration_secs: 200, termination_reason: "end_call tool was called." },
  conversation_initiation_client_data: { dynamic_variables: { interview_id: "int_1" } },
  ...overrides,
});

const DROPPED = { start_time_unix_secs: 1_760_000_000, call_duration_secs: 200, termination_reason: "Client disconnected: 1005" };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "int_1",
  userId: "user_1",
  callAllowedSeconds: null,
  status: "IN_PROGRESS",
  conversationId: "conv_2",
  issuedConversationIds: ["conv_1", "conv_2"],
  transcript: null,
  issuedContext: null,
  startCount: 2,
  usageEventId: "evt_1",
  tier: "FULL",
  segments: null,
  finishRequestedAt: null,
  resumableUntil: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
  tx.interview.updateMany.mockResolvedValue({ count: 1 });
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
});

describe("storeConversationTranscript: one interview, several calls", () => {
  const earlier = { conversationId: "conv_1", turns: [{ role: "agent", message: "Tell me about your last project?", time_in_call_secs: 0 }, { role: "user", message: "I led a migration.", time_in_call_secs: 5 }], durationSeconds: 180, startTimeSeconds: 1_759_999_000 };

  // A minute after the fixture call ended: its resume window is open.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date((1_760_000_000 + 260) * 1000));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a record that arrives after its resume window is over closes the interview", async () => {
    vi.setSystemTime(new Date((1_760_000_000 + 200 + 601) * 1000));
    findFirst.mockResolvedValueOnce(row({ startCount: 1 }) as never);
    expect(await storeConversationTranscript({ data: toCallRecord(payload({ metadata: DROPPED })), eventTimestamp: null })).toMatchObject({ status: "FEEDBACK_PENDING" });
  });

  it("a call that drops after an answer leaves the interview resumable, with its unit kept", async () => {
    findFirst.mockResolvedValueOnce(row({ startCount: 1 }) as never);

    const result = await storeConversationTranscript({ data: toCallRecord(payload({ metadata: DROPPED })), eventTimestamp: null });

    expect(result).toEqual({ outcome: "stored", interviewId: "int_1", status: "IN_PROGRESS" });
    const { data } = updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({ status: "IN_PROGRESS", failureReason: null, durationSeconds: 200 });
    // Ten minutes from the end of the call.
    expect(data.resumableUntil).toEqual(new Date((1_760_000_000 + 200 + 600) * 1000));
    expect(data).not.toHaveProperty("segments");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("the resumed call's end_call closes it: every call merged in order, with the marker between them, and the time summed", async () => {
    findFirst.mockResolvedValueOnce(row({ segments: [earlier] }) as never);

    const result = await storeConversationTranscript({ data: toCallRecord(payload()), eventTimestamp: null });

    expect(result).toEqual({ outcome: "stored", interviewId: "int_1", status: "FEEDBACK_PENDING" });
    const { data } = updateMany.mock.calls[0][0] as { data: { transcript: Array<{ role: string; message: string; time_in_call_secs: number }>; durationSeconds: number; segments: unknown[]; resumableUntil: unknown } };
    expect(data.transcript.map((turn) => `${turn.role}@${turn.time_in_call_secs}`)).toEqual(["agent@0", "user@5", "system@180", "agent@180", "user@183"]);
    expect(data.transcript[2].message).toBe("[call resumed]");
    expect(data.durationSeconds).toBe(380);
    expect(data.segments).toHaveLength(2);
    expect(data.resumableUntil).toBeNull();
  });

  it("a second delivery of a call already kept as a segment is a duplicate", async () => {
    findFirst.mockResolvedValueOnce(row({ segments: [earlier] }) as never);
    expect(await storeConversationTranscript({ data: toCallRecord(payload({ conversation_id: "conv_1" })), eventTimestamp: null })).toEqual({ outcome: "duplicate", interviewId: "int_1" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("a resumed call in which the candidate said nothing is still part of the interview", async () => {
    findFirst.mockResolvedValueOnce(row({ segments: [earlier], finishRequestedAt: new Date() }) as never);
    const silent = payload({ transcript: [{ role: "agent", message: "Welcome back. We will pick up where we left off.", time_in_call_secs: 0 }], metadata: { ...DROPPED, call_duration_secs: 5 } });

    expect(await storeConversationTranscript({ data: toCallRecord(silent), eventTimestamp: null })).toMatchObject({ status: "FEEDBACK_PENDING" });
    const { data } = updateMany.mock.calls[0][0] as { data: { transcript: Array<{ role: string }>; durationSeconds: number } };
    expect(data.transcript.map((turn) => turn.role)).toEqual(["agent", "user", "system", "agent"]);
    expect(data.durationSeconds).toBe(185);
    // The unit stays spent: the candidate spoke in the first call.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("the candidate's request to finish closes it on the drop's record", async () => {
    findFirst.mockResolvedValueOnce(row({ finishRequestedAt: new Date() }) as never);
    expect(await storeConversationTranscript({ data: toCallRecord(payload({ metadata: DROPPED })), eventTimestamp: null })).toMatchObject({ status: "FEEDBACK_PENDING" });
  });

  it("the interview length used up across calls closes it", async () => {
    findFirst.mockResolvedValueOnce(row({ segments: [{ ...earlier, durationSeconds: 500 }] }) as never);
    // 500 s + 200 s of 720: under thirty seconds left.
    expect(await storeConversationTranscript({ data: toCallRecord(payload({ metadata: DROPPED })), eventTimestamp: null })).toMatchObject({ status: "FEEDBACK_PENDING" });
    expect((updateMany.mock.calls[0][0] as { data: { durationSeconds: number } }).data.durationSeconds).toBe(700);
  });

  it("the last start's drop closes it: there is no reconnect left", async () => {
    findFirst.mockResolvedValueOnce(row({ startCount: 3 }) as never);
    expect(await storeConversationTranscript({ data: toCallRecord(payload({ metadata: DROPPED })), eventTimestamp: null })).toMatchObject({ status: "FEEDBACK_PENDING" });
  });

  it("a resumed call the platform could not run gives its start back and keeps the interview and its unit", async () => {
    findFirst.mockResolvedValueOnce(row({ segments: [earlier], resumableUntil: new Date("2026-11-11T12:10:00Z") }) as never);

    const failed = payload({ status: "failed", transcript: [], metadata: { start_time_unix_secs: 1_760_000_000, call_duration_secs: 0, termination_reason: "", error: { code: 4300, reason: "This AI agent is currently at max capacity. Please try again later." } } });
    const result = await storeConversationTranscript({ data: toCallRecord(failed), eventTimestamp: null });

    expect(result).toEqual({ outcome: "stored", interviewId: "int_1", status: "IN_PROGRESS" });
    const { data } = updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({ startCount: { decrement: 1 }, resumableUntil: new Date("2026-11-11T12:10:00Z") });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("a first call refused for capacity is AT_CAPACITY: the start and the unit go back", async () => {
    findFirst.mockResolvedValueOnce(row({ startCount: 1 }) as never);

    const failed = payload({ status: "failed", transcript: [], metadata: { start_time_unix_secs: 1_760_000_000, call_duration_secs: 0, termination_reason: "", error: { code: 4300, reason: "This AI agent is currently at max capacity. Please try again later." } } });
    await storeConversationTranscript({ data: toCallRecord(failed), eventTimestamp: null });

    expect(updateMany.mock.calls[0][0]).toMatchObject({ data: { status: "IN_PROGRESS", failureReason: "AT_CAPACITY", startCount: { decrement: 1 } } });
    expect(tx.interview.updateMany).toHaveBeenCalledWith({ where: { id: "int_1", usageEventId: "evt_1" }, data: { usageEventId: null } });
  });
});

describe("storeConversationTranscript: one call, two deliveries at once", () => {
  it("writes only on a row that has no transcript yet, so the webhook and the API fetch racing store the call once", async () => {
    // Both read the row before either wrote; the call left the interview in progress (nobody spoke).
    findFirst.mockResolvedValue(row({ startCount: 1 }) as never);
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const silent = payload({ transcript: [{ role: "agent", message: "Hi.", time_in_call_secs: 0 }], metadata: DROPPED });

    const [first, second] = await Promise.all([
      storeConversationTranscript({ data: toCallRecord(silent), eventTimestamp: null, source: "elevenlabs-api" }),
      storeConversationTranscript({ data: toCallRecord(silent), eventTimestamp: null }),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual(["duplicate", "stored"]);
    for (const call of updateMany.mock.calls) expect((call[0] as { where: Record<string, unknown> }).where.transcriptSource).toBeNull();
    // The unit goes back once.
    expect(refundUsageIn).toHaveBeenCalledTimes(1);
    findFirst.mockReset();
  });
});

describe("storeConversationTranscript: a call that ran past the time it was allowed", () => {
  const overrunLines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("CALL OVERRUN"));

  it("logs an error with the user and interview ids and counts it on the user, and still stores the call", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // A resumed call allowed 120 s whose record says 200 s.
    findFirst.mockResolvedValueOnce(row({ callAllowedSeconds: 120 }) as never);

    expect(await storeConversationTranscript({ data: toCallRecord(payload()), eventTimestamp: null })).toMatchObject({ outcome: "stored" });

    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: "user_1" }, data: { callOverruns: { increment: 1 } } });
    expect(overrunLines(error)).toEqual(["[CVision][voice] CALL OVERRUN user=user_1 interview=int_1 conversation=conv_2 allowed=120s recorded=200s over=80s; overruns by this user: 2"]);
    error.mockRestore();
  });

  it("says nothing inside the tolerance, for a row with no allowance, or for an earlier call's late record", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    findFirst.mockResolvedValueOnce(row({ callAllowedSeconds: 190 }) as never);
    await storeConversationTranscript({ data: toCallRecord(payload()), eventTimestamp: null });
    findFirst.mockResolvedValueOnce(row() as never);
    await storeConversationTranscript({ data: toCallRecord(payload()), eventTimestamp: null });
    // conv_1's record arrives after conv_2 was issued: the allowance on the row is conv_2's.
    findFirst.mockResolvedValueOnce(row({ callAllowedSeconds: 60 }) as never);
    await storeConversationTranscript({ data: toCallRecord(payload({ conversation_id: "conv_1" })), eventTimestamp: null });

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(overrunLines(error)).toEqual([]);
    error.mockRestore();
  });

  it("a count that cannot be written does not lose the transcript", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.user.updateMany).mockRejectedValueOnce(new Error("db down"));
    findFirst.mockResolvedValueOnce(row({ callAllowedSeconds: 120 }) as never);
    expect(await storeConversationTranscript({ data: toCallRecord(payload()), eventTimestamp: null })).toMatchObject({ outcome: "stored" });
    expect(overrunLines(error)).toHaveLength(1);
    error.mockRestore();
  });
});

describe("storeConversationTranscript: how a delivery finds its row", () => {
  it("matches on membership in the issued ids, so an earlier session's delivery still lands: kept as a segment beside the newer call", async () => {
    findFirst.mockResolvedValueOnce(row() as never);

    const result = await storeConversationTranscript({ data: toCallRecord(payload({ conversation_id: "conv_1" })), eventTimestamp: null });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0]).toMatchObject({
      where: { issuedConversationIds: { has: "conv_1" } },
    });
    expect(result).toEqual({ outcome: "stored", interviewId: "int_1", status: "IN_PROGRESS" });
    // The newer call stays the row's; the earlier one waits in the segments, and the window opens.
    const write = updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(write.where).toMatchObject({ id: "int_1", status: "IN_PROGRESS", conversationId: "conv_2" });
    expect(write.data).not.toHaveProperty("status");
    expect(write.data).not.toHaveProperty("conversationId");
    expect(write.data.segments).toMatchObject([{ conversationId: "conv_1", durationSeconds: 200 }]);
    expect(write.data.resumableUntil).toBeInstanceOf(Date);
  });

  it("falls back to the interview_id variable only for a row that was never issued a session", async () => {
    findFirst.mockResolvedValueOnce(null as never).mockResolvedValueOnce(row({ issuedConversationIds: [], conversationId: null }) as never);

    await storeConversationTranscript({ data: toCallRecord(payload({ conversation_id: "conv_x" })), eventTimestamp: null });

    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst.mock.calls[1][0]).toMatchObject({
      where: { id: "int_1", issuedConversationIds: { isEmpty: true } },
    });
  });

  it("does not use the variable when the delivery names no interview, and reports unmatched", async () => {
    findFirst.mockResolvedValueOnce(null as never);

    const result = await storeConversationTranscript({
      data: toCallRecord(payload({ conversation_id: "conv_x", conversation_initiation_client_data: null })),
      eventTimestamp: null,
    });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: "unmatched" });
  });

  it("a finished call closes the interview; a later delivery for another issued session is a duplicate", async () => {
    // The latest call, conv_2, ends by the interviewer's end_call.
    findFirst.mockResolvedValueOnce(row() as never);
    expect(await storeConversationTranscript({ data: toCallRecord(payload({ conversation_id: "conv_2" })), eventTimestamp: null })).toMatchObject({
      outcome: "stored",
      status: "FEEDBACK_PENDING",
    });

    // Then conv_1 delivers: the row is past the startable states.
    findFirst.mockResolvedValueOnce(row({ status: "FEEDBACK_PENDING", conversationId: "conv_2", transcript: [{ role: "user", message: "Hello." }] }) as never);
    expect(await storeConversationTranscript({ data: toCallRecord(payload({ conversation_id: "conv_1" })), eventTimestamp: null })).toEqual({
      outcome: "duplicate",
      interviewId: "int_1",
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("marks the reconcile fetch as the API's source", async () => {
    findFirst.mockResolvedValueOnce(row() as never);

    await storeConversationTranscript({ data: toCallRecord(payload()), eventTimestamp: null, source: "elevenlabs-api" });

    expect(updateMany.mock.calls[0][0]).toMatchObject({ data: { transcriptSource: "elevenlabs-api" } });
  });

  it("writes the times the delivery carries, and leaves them alone when it carries none", async () => {
    findFirst.mockResolvedValueOnce(row() as never);
    await storeConversationTranscript({ data: toCallRecord(payload()), eventTimestamp: null });
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      data: { startedAt: new Date(1_760_000_000 * 1000), endedAt: new Date((1_760_000_000 + 200) * 1000), durationSeconds: 200 },
    });

    // No metadata and no event timestamp: the room's endedAt must survive.
    findFirst.mockResolvedValueOnce(row() as never);
    await storeConversationTranscript({ data: toCallRecord(payload({ metadata: null })), eventTimestamp: null });
    const { data } = updateMany.mock.calls[1][0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty("endedAt");
    expect(data).not.toHaveProperty("durationSeconds");
    expect(data).not.toHaveProperty("startedAt");
  });
});

describe("the usage unit when the interview ends with nothing to score", () => {
  const silent = () =>
    payload({ transcript: [{ role: "agent", message: "Hello? Can you hear me?", time_in_call_secs: 0 }] });

  it("refunds the unit when the last start ends silent and the interview fails", async () => {
    findFirst.mockResolvedValueOnce(row({ startCount: 3 }) as never);

    const result = await storeConversationTranscript({ data: toCallRecord(silent()), eventTimestamp: null });

    expect(result).toEqual({ outcome: "stored", interviewId: "int_1", status: "FAILED" });
    expect(refundUsageIn).toHaveBeenCalledWith(tx, "evt_1", "NO_CANDIDATE_TURNS");
    // FAILED keeps the reservation on the row for support to read.
    expect(tx.interview.updateMany).not.toHaveBeenCalled();
    // The silent call was the candidate's microphone: the start stays counted.
    expect((updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data).not.toHaveProperty("startCount");
  });

  it("refunds a silent attempt with starts left at once, whatever paid for it, and forgets the reservation in the same transaction so the next start reserves again", async () => {
    findFirst.mockResolvedValueOnce(row({ startCount: 1 }) as never);
    const result = await storeConversationTranscript({ data: toCallRecord(silent()), eventTimestamp: null });

    expect(result).toEqual({ outcome: "stored", interviewId: "int_1", status: "IN_PROGRESS" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(refundUsageIn).toHaveBeenCalledWith(tx, "evt_1", "NO_CANDIDATE_TURNS");
    expect(tx.interview.updateMany).toHaveBeenCalledWith({ where: { id: "int_1", usageEventId: "evt_1" }, data: { usageEventId: null } });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("refunds a call the platform could not run (status failed, nothing heard) under CALL_FAILED and gives the start back too, in the same write, even at the cap", async () => {
    findFirst.mockResolvedValueOnce(row({ startCount: 3 }) as never);
    const data = fromConversationApi({
      agentId: "agent_1",
      conversationId: "conv_2",
      status: "failed",
      transcript: [],
      metadata: { startTimeUnixSecs: 1_792_734_157, callDurationSecs: 0, terminationReason: "", error: { code: 3000, reason: "[quota_exceeded] You've run out of credits." } },
      conversationInitiationClientData: { dynamicVariables: { interview_id: "int_1" } },
    });

    const result = await storeConversationTranscript({ data: toCallRecord(data), eventTimestamp: null, source: "elevenlabs-api" });

    expect(result).toEqual({ outcome: "stored", interviewId: "int_1", status: "IN_PROGRESS" });
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "int_1", startCount: { gt: 0 } },
      data: { status: "IN_PROGRESS", failureReason: "CALL_FAILED", transcriptSource: "elevenlabs-api", durationSeconds: 0, startCount: { decrement: 1 } },
    });
    expect(refundUsageIn).toHaveBeenCalledWith(tx, "evt_1", "CALL_FAILED");
    expect(tx.interview.updateMany).toHaveBeenCalledWith({ where: { id: "int_1", usageEventId: "evt_1" }, data: { usageEventId: null } });
  });

  it("keeps the unit when the candidate spoke, and when a silent delivery is from an earlier session than the row's", async () => {
    findFirst.mockResolvedValueOnce(row() as never);
    await storeConversationTranscript({ data: toCallRecord(payload()), eventTimestamp: null });
    expect(refundUsageIn).not.toHaveBeenCalled();

    // conv_1 is an earlier session; conv_2, the latest, may be live and holds the unit.
    findFirst.mockResolvedValueOnce(row({ startCount: 1 }) as never);
    await storeConversationTranscript({ data: toCallRecord(silent().conversation_id === "conv_2" ? { ...silent(), conversation_id: "conv_1" } : silent()), eventTimestamp: null });
    expect(refundUsageIn).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("markSessionLost refunds whether or not a start is left, fails the interview only when none is, and forgets the reservation only while one is", async () => {
    await markSessionLost({ interviewId: "int_1", conversationId: "conv_2", reason: "SESSION_LOST", exhausted: false, usageEventId: "evt_1" });
    expect(updateMany.mock.calls[0][0]).toMatchObject({ data: { failureReason: "SESSION_LOST" } });
    expect((updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data).not.toHaveProperty("status");
    expect(refundUsageIn).toHaveBeenCalledWith(tx, "evt_1", "SESSION_LOST");
    expect(tx.interview.updateMany).toHaveBeenCalledWith({ where: { id: "int_1", usageEventId: "evt_1" }, data: { usageEventId: null } });

    vi.clearAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
    await markSessionLost({ interviewId: "int_1", conversationId: "conv_2", reason: "SESSION_LOST", exhausted: true, usageEventId: "evt_1" });
    expect(updateMany.mock.calls[0][0]).toMatchObject({ data: { failureReason: "SESSION_LOST", status: "FAILED" } });
    expect(refundUsageIn).toHaveBeenCalledWith(tx, "evt_1", "SESSION_LOST");
    expect(tx.interview.updateMany).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

describe("claimReconcile", () => {
  const now = new Date("2026-10-16T12:00:00Z");

  it("takes the slot only when the last check is older than the interval, or there was none", async () => {
    expect(await claimReconcile({ interviewId: "int_1", now, minIntervalMs: 60_000 })).toBe(true);

    expect(updateMany.mock.calls[0][0]).toEqual({
      where: {
        id: "int_1",
        OR: [{ reconcileCheckedAt: null }, { reconcileCheckedAt: { lt: new Date("2026-10-16T11:59:00Z") } }],
      },
      data: { reconcileCheckedAt: now },
    });
  });

  it("reports false when another check holds the slot", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await claimReconcile({ interviewId: "int_1", now, minIntervalMs: 60_000 })).toBe(false);
  });
});

describe("markSessionLost", () => {
  it("writes the reason only while the row is startable, on that conversation, with no transcript", async () => {
    expect(
      await markSessionLost({ interviewId: "int_1", conversationId: "conv_2", reason: "SESSION_LOST", exhausted: false, usageEventId: null }),
    ).toBe(true);

    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "int_1", conversationId: "conv_2", transcriptSource: null },
      data: { failureReason: "SESSION_LOST" },
    });
  });
});
