import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import type { PostCallTranscription } from "@/lib/elevenlabs/postCall";
import { claimReconcile, markSessionLost, storeConversationTranscript } from "./interviewTranscript";
import { refundUsage } from "./usage";

vi.mock("@/lib/prisma", () => ({
  default: {
    interview: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("./usage", () => ({ refundUsage: vi.fn(async () => true) }));

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
  metadata: { start_time_unix_secs: 1_760_000_000, call_duration_secs: 200, termination_reason: null },
  conversation_initiation_client_data: { dynamic_variables: { interview_id: "int_1" } },
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "int_1",
  status: "IN_PROGRESS",
  conversationId: "conv_2",
  issuedConversationIds: ["conv_1", "conv_2"],
  transcript: null,
  issuedContext: null,
  startCount: 2,
  usageEventId: "evt_1",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
});

describe("storeConversationTranscript: how a delivery finds its row", () => {
  it("matches on membership in the issued ids, so an earlier session's delivery still lands", async () => {
    findFirst.mockResolvedValueOnce(row() as never);

    const result = await storeConversationTranscript({ data: payload({ conversation_id: "conv_1" }), eventTimestamp: null });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0]).toMatchObject({
      where: { issuedConversationIds: { has: "conv_1" } },
    });
    expect(result).toEqual({ outcome: "stored", interviewId: "int_1", status: "FEEDBACK_PENDING" });
    // The stored transcript's conversation becomes the row's, and the source is the webhook's.
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "int_1" },
      data: { conversationId: "conv_1", transcriptSource: "elevenlabs", status: "FEEDBACK_PENDING" },
    });
  });

  it("falls back to the interview_id variable only for a row that was never issued a session", async () => {
    findFirst.mockResolvedValueOnce(null as never).mockResolvedValueOnce(row({ issuedConversationIds: [], conversationId: null }) as never);

    await storeConversationTranscript({ data: payload({ conversation_id: "conv_x" }), eventTimestamp: null });

    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst.mock.calls[1][0]).toMatchObject({
      where: { id: "int_1", issuedConversationIds: { isEmpty: true } },
    });
  });

  it("does not use the variable when the delivery names no interview, and reports unmatched", async () => {
    findFirst.mockResolvedValueOnce(null as never);

    const result = await storeConversationTranscript({
      data: payload({ conversation_id: "conv_x", conversation_initiation_client_data: null }),
      eventTimestamp: null,
    });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: "unmatched" });
  });

  it("the first delivery with candidate turns wins; a later one for another issued session is a duplicate", async () => {
    // First call: conv_1 delivers with candidate turns.
    findFirst.mockResolvedValueOnce(row() as never);
    expect(await storeConversationTranscript({ data: payload({ conversation_id: "conv_1" }), eventTimestamp: null })).toMatchObject({
      outcome: "stored",
      status: "FEEDBACK_PENDING",
    });

    // Then conv_2 delivers: the row is past the startable states.
    findFirst.mockResolvedValueOnce(row({ status: "FEEDBACK_PENDING", conversationId: "conv_1", transcript: [{ role: "user", message: "Hello." }] }) as never);
    expect(await storeConversationTranscript({ data: payload({ conversation_id: "conv_2" }), eventTimestamp: null })).toEqual({
      outcome: "duplicate",
      interviewId: "int_1",
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("marks the reconcile fetch as the API's source", async () => {
    findFirst.mockResolvedValueOnce(row() as never);

    await storeConversationTranscript({ data: payload(), eventTimestamp: null, source: "elevenlabs-api" });

    expect(updateMany.mock.calls[0][0]).toMatchObject({ data: { transcriptSource: "elevenlabs-api" } });
  });

  it("writes the times the delivery carries, and leaves them alone when it carries none", async () => {
    findFirst.mockResolvedValueOnce(row() as never);
    await storeConversationTranscript({ data: payload(), eventTimestamp: null });
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      data: { startedAt: new Date(1_760_000_000 * 1000), endedAt: new Date((1_760_000_000 + 200) * 1000), durationSeconds: 200 },
    });

    // No metadata and no event timestamp: the room's endedAt must survive.
    findFirst.mockResolvedValueOnce(row() as never);
    await storeConversationTranscript({ data: payload({ metadata: null }), eventTimestamp: null });
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

    const result = await storeConversationTranscript({ data: silent(), eventTimestamp: null });

    expect(result).toEqual({ outcome: "stored", interviewId: "int_1", status: "FAILED" });
    expect(refundUsage).toHaveBeenCalledWith("evt_1", "NO_CANDIDATE_TURNS");
  });

  it("keeps the unit while a silent attempt still has starts left, and when the candidate spoke", async () => {
    findFirst.mockResolvedValueOnce(row({ startCount: 1 }) as never);
    await storeConversationTranscript({ data: silent(), eventTimestamp: null });
    findFirst.mockResolvedValueOnce(row() as never);
    await storeConversationTranscript({ data: payload(), eventTimestamp: null });

    expect(refundUsage).not.toHaveBeenCalled();
  });

  it("markSessionLost fails the interview and refunds only when no start is left", async () => {
    await markSessionLost({ interviewId: "int_1", conversationId: "conv_2", reason: "SESSION_LOST", exhausted: false, usageEventId: "evt_1" });
    expect(updateMany.mock.calls[0][0]).toMatchObject({ data: { failureReason: "SESSION_LOST" } });
    expect((updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data).not.toHaveProperty("status");
    expect(refundUsage).not.toHaveBeenCalled();

    await markSessionLost({ interviewId: "int_1", conversationId: "conv_2", reason: "SESSION_LOST", exhausted: true, usageEventId: "evt_1" });
    expect(updateMany.mock.calls[1][0]).toMatchObject({ data: { failureReason: "SESSION_LOST", status: "FAILED" } });
    expect(refundUsage).toHaveBeenCalledWith("evt_1", "SESSION_LOST");
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
