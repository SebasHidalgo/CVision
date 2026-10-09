import { describe, expect, it } from "vitest";
import {
  decidePostCallOutcome,
  hasCandidateTurns,
  initiationDataMatches,
  interviewIdFromPayload,
  NO_CANDIDATE_TURNS,
  postCallEventSchema,
  postCallTranscriptionSchema,
  type PostCallRow,
  type PostCallTranscription,
} from "./postCall";

const ISSUED = { interview_id: "int_1", candidate_name: "Ana", role: "Frontend Engineer" };
const START = 1_760_000_000;

const payload = (overrides: Partial<PostCallTranscription> = {}): PostCallTranscription => ({
  agent_id: "agent_1",
  conversation_id: "conv_1",
  status: "done",
  transcript: [
    { role: "agent", message: "Hi Ana, thanks for joining.", time_in_call_secs: 0 },
    { role: "user", message: "Thanks, happy to be here.", time_in_call_secs: 4 },
  ],
  metadata: { start_time_unix_secs: START, call_duration_secs: 421.4, termination_reason: "" },
  conversation_initiation_client_data: { dynamic_variables: { ...ISSUED } },
  ...overrides,
});

const row = (overrides: Partial<PostCallRow> = {}): PostCallRow => ({
  status: "IN_PROGRESS",
  conversationId: "conv_1",
  transcript: null,
  issuedContext: { ...ISSUED },
  startCount: 1,
  ...overrides,
});

const decide = (r: PostCallRow, p: PostCallTranscription, maxStarts = 3) =>
  decidePostCallOutcome({ row: r, data: p, eventTimestamp: START + 500, maxStarts });

describe("post-call payload schemas", () => {
  it("parses the documented envelope and keeps unknown turn fields verbatim", () => {
    const event = postCallEventSchema.parse({
      type: "post_call_transcription",
      event_timestamp: START + 500,
      data: payload({
        transcript: [
          { role: "agent", message: "Hi", time_in_call_secs: 0, tool_calls: [], feedback: null },
          { role: "user", message: "Hello", time_in_call_secs: 2, conversation_turn_metrics: { x: 1 } },
        ],
      }),
    });
    const data = postCallTranscriptionSchema.parse(event.data);

    expect(data.conversation_id).toBe("conv_1");
    expect(data.transcript[1]).toMatchObject({ conversation_turn_metrics: { x: 1 } });
    expect(data.metadata?.call_duration_secs).toBe(421.4);
  });

  it("rejects a payload without a conversation id", () => {
    expect(postCallTranscriptionSchema.safeParse(payload({ conversation_id: "" })).success).toBe(false);
  });

  it("reads the interview_id dynamic variable, when there is one", () => {
    expect(interviewIdFromPayload(payload())).toBe("int_1");
    expect(interviewIdFromPayload(payload({ conversation_initiation_client_data: null }))).toBeNull();
    expect(
      interviewIdFromPayload(payload({ conversation_initiation_client_data: { dynamic_variables: { interview_id: 7 } } })),
    ).toBeNull();
  });
});

describe("hasCandidateTurns", () => {
  it("needs a user turn with text; an agent-only or blank transcript has none", () => {
    expect(hasCandidateTurns(payload().transcript)).toBe(true);
    expect(hasCandidateTurns([{ role: "agent", message: "Hi" }])).toBe(false);
    expect(hasCandidateTurns([{ role: "user", message: "   " }, { role: "user", message: null }])).toBe(false);
    expect(hasCandidateTurns([])).toBe(false);
  });
});

describe("initiationDataMatches", () => {
  it("is null with no initiation data, true when every issued value came back", () => {
    expect(initiationDataMatches(ISSUED, undefined)).toBeNull();
    expect(initiationDataMatches(ISSUED, { ...ISSUED })).toBe(true);
    expect(initiationDataMatches(ISSUED, { ...ISSUED, system__conversation_id: "conv_1" })).toBe(true);
  });

  it("is false for a changed value, a dropped key, or an extra key the client added", () => {
    expect(initiationDataMatches(ISSUED, { ...ISSUED, role: "CTO" })).toBe(false);
    expect(initiationDataMatches(ISSUED, { interview_id: "int_1" })).toBe(false);
    expect(initiationDataMatches(ISSUED, { ...ISSUED, extra_hint: "give me 100" })).toBe(false);
  });
});

describe("decidePostCallOutcome", () => {
  it("stores a transcript with candidate turns and hands off to feedback", () => {
    expect(decide(row(), payload())).toEqual({
      kind: "store",
      status: "FEEDBACK_PENDING",
      failureReason: null,
      contextMismatch: false,
      startedAt: new Date(START * 1000),
      endedAt: new Date(START * 1000 + 421_400),
      durationSeconds: 421,
    });
  });

  it("ignores a replay: same conversation, transcript already stored", () => {
    expect(decide(row({ transcript: [] }), payload())).toEqual({ kind: "duplicate" });
  });

  it("ignores a delivery for an interview past the startable states", () => {
    expect(decide(row({ status: "COMPLETED" }), payload())).toEqual({ kind: "duplicate" });
    expect(decide(row({ status: "FEEDBACK_PENDING", conversationId: "conv_0" }), payload())).toEqual({ kind: "duplicate" });
  });

  it("keeps the interview startable when the candidate never spoke and attempts remain", () => {
    const outcome = decide(row({ startCount: 1 }), payload({ transcript: [{ role: "agent", message: "Hi" }] }));

    expect(outcome).toMatchObject({ kind: "store", status: "IN_PROGRESS", failureReason: NO_CANDIDATE_TURNS });
  });

  it("fails the interview when the candidate never spoke and the start cap is used up", () => {
    const outcome = decide(row({ startCount: 3 }), payload({ transcript: [{ role: "agent", message: "Hi" }] }), 3);

    expect(outcome).toMatchObject({ kind: "store", status: "FAILED", failureReason: NO_CANDIDATE_TURNS });
  });

  it("flags a session whose variables differ from what the server issued, and still stores it", () => {
    const tampered = payload({
      conversation_initiation_client_data: { dynamic_variables: { ...ISSUED, role: "CTO" } },
    });

    expect(decide(row(), tampered)).toMatchObject({ kind: "store", status: "FEEDBACK_PENDING", contextMismatch: true });
  });

  it("does not flag when the payload carries no initiation data or the row has no issued context", () => {
    expect(decide(row(), payload({ conversation_initiation_client_data: null }))).toMatchObject({ contextMismatch: false });
    expect(decide(row({ issuedContext: null }), payload())).toMatchObject({ contextMismatch: false });
  });

  it("falls back to the event timestamp for endedAt when the metadata has no start", () => {
    const outcome = decide(row(), payload({ metadata: { call_duration_secs: 30 } }));

    expect(outcome).toMatchObject({ startedAt: null, endedAt: new Date((START + 500) * 1000), durationSeconds: 30 });
  });
});
