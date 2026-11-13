import { describe, expect, it } from "vitest";
import {
  CALL_FAILED,
  CALL_OVERRUN_TOLERANCE_SECONDS,
  callOverrunSeconds,
  decidePostCallOutcome,
  hasCandidateTurns,
  initiationDataMatches,
  interviewIdFromRecord,
  isStranded,
  NO_CANDIDATE_TURNS,
  platformFailure,
  RECONCILE_GRACE_SECONDS,
  type PostCallRow,
  type StrandedCandidate,
} from "./postCall";
import { fromConversationApi, postCallEventSchema, postCallTranscriptionSchema, toCallRecord, type PostCallTranscription } from "./elevenlabs/wire";

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
  metadata: { start_time_unix_secs: START, call_duration_secs: 421.4, termination_reason: "end_call tool was called." },
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
  decidePostCallOutcome({ row: r, data: toCallRecord(p), eventTimestamp: START + 500, maxStarts });

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
    expect(interviewIdFromRecord(toCallRecord(payload()))).toBe("int_1");
    expect(interviewIdFromRecord(toCallRecord(payload({ conversation_initiation_client_data: null })))).toBeNull();
    expect(
      interviewIdFromRecord(toCallRecord(payload({ conversation_initiation_client_data: { dynamic_variables: { interview_id: 7 } } }))),
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

describe("toCallRecord: how the call ended", () => {
  const endedBy = (reason: string | null) => toCallRecord(payload({ metadata: { start_time_unix_secs: START, call_duration_secs: 10, termination_reason: reason } })).endedBy;

  it("tells the interviewer, the limit and the client apart, and takes any other wording as the platform's own end", () => {
    expect(endedBy("end_call tool was called.")).toBe("agent");
    expect(endedBy("Maximum duration exceeded")).toBe("limit");
    expect(endedBy("Client disconnected: 1005")).toBe("client");
    expect(endedBy("Call ended due to silence timeout")).toBe("platform");
    expect(endedBy("")).toBe("unknown");
    expect(endedBy(null)).toBe("unknown");
  });

  it("reads the reason the interviewer gave end_call from the webhook's tool turn", () => {
    const record = toCallRecord(
      payload({
        transcript: [
          { role: "agent", message: "Thanks.", time_in_call_secs: 0 },
          { role: "agent", message: null, time_in_call_secs: 2, tool_calls: [{ tool_name: "contextual_update", params_as_json: "{}" }] },
          { role: "agent", message: null, time_in_call_secs: 3, tool_calls: [{ tool_name: "end_call", params_as_json: JSON.stringify({ reason: " The time is up. ", system__message_to_speak: "Bye" }) }] },
        ],
      }),
    );
    expect(record.endCallReason).toBe("The time is up.");
    expect(record.terminationReason).toBe("end_call tool was called.");
    // A tool call with unreadable parameters says nothing rather than throwing.
    expect(toCallRecord(payload({ transcript: [{ role: "agent", message: null, tool_calls: [{ tool_name: "end_call", params_as_json: "{" }] }] })).endCallReason).toBeNull();
  });
});

describe("decidePostCallOutcome", () => {
  it("stores a transcript with candidate turns and hands off to feedback", () => {
    expect(decide(row(), payload())).toMatchObject({
      kind: "store",
      status: "FEEDBACK_PENDING",
      failureReason: null,
      contextMismatch: false,
      startedAt: new Date(START * 1000),
      endedAt: new Date(START * 1000 + 421_400),
      durationSeconds: 421,
      startRefunded: false,
    });
  });

  // A five-minute call that ended after `seconds`, with these last turns and this end.
  const ended = (seconds: number, last: PostCallTranscription["transcript"], reason = "end_call tool was called.", r: PostCallRow = row()) =>
    decidePostCallOutcome({
      row: r,
      data: toCallRecord(payload({ transcript: [...payload().transcript, ...last], metadata: { start_time_unix_secs: START, call_duration_secs: seconds, termination_reason: reason } })),
      eventTimestamp: START + 500,
      maxStarts: 3,
      plannedSeconds: 300,
      now: new Date((START + seconds + 5) * 1000),
    });
  const GOODBYE = { role: "agent", message: "Thanks for practicing, Ana. Your feedback will appear on your screen in a moment.", time_in_call_secs: 230 };
  const QUESTION = { role: "agent", message: "To finish, tell me about a project you led, and what your part in it was.", time_in_call_secs: 218 };
  const END_CALL = { role: "agent", message: null, time_in_call_secs: 220, tool_calls: [{ tool_name: "end_call", params_as_json: JSON.stringify({ reason: "The interview is reaching its conclusion.", system__message_to_speak: "Thanks." }) }] };

  it("keeps the owner's first trial resumable: a last request with no answer, end_call at 235 s of 300", () => {
    const outcome = ended(235, [QUESTION, END_CALL]);
    expect(outcome).toMatchObject({ status: "IN_PROGRESS", counted: true, startRefunded: true, earlyEnd: true, callEnd: { reason: "interviewer", detail: "The interview is reaching its conclusion.", recorded: true } });
    expect((outcome as { resumableUntil: Date | null }).resumableUntil).toEqual(new Date((START + 235 + 600) * 1000));
  });

  it("scores an interview the interviewer closed with a goodbye inside the wrap-up time", () => {
    expect(ended(250, [GOODBYE])).toMatchObject({ status: "FEEDBACK_PENDING", resumableUntil: null, earlyEnd: false, startRefunded: false, callEnd: { reason: "interviewer" } });
  });

  it("keeps it resumable when the interviewer hangs up without a goodbye, or says one with minutes left unasked", () => {
    // The candidate spoke last and the call just ended.
    expect(ended(240, [])).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true, startRefunded: true });
    // A clean goodbye at 178 s of 300 that nobody asked for.
    expect(ended(178, [GOODBYE])).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true });
    // The same goodbye after the candidate confirmed they wanted to end.
    const confirmed = [
      { role: "agent", message: "Do you want to end the interview now?", time_in_call_secs: 170 },
      { role: "user", message: "Yes, let's stop.", time_in_call_secs: 174 },
      GOODBYE,
    ];
    expect(ended(178, confirmed)).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false });
  });

  it("lets any interviewer end stand with 30 s or less left, and the platform's limit always", () => {
    expect(ended(271, [QUESTION, END_CALL])).toMatchObject({ status: "FEEDBACK_PENDING" });
    expect(ended(120, [QUESTION], "Maximum duration exceeded")).toMatchObject({ status: "FEEDBACK_PENDING", callEnd: { reason: "limit" } });
  });

  it("treats a platform-side end over a pending question as early, and records the platform's wording", () => {
    const outcome = ended(150, [QUESTION], "Call ended due to silence timeout");
    expect(outcome).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true, startRefunded: true, callEnd: { reason: "platform", detail: "Call ended due to silence timeout" } });
  });

  it("settles a client-side end by what the room reported: End, its own hang-up, or a drop", () => {
    const left = "Client disconnected: 1005";
    const finished = row({ finishRequestedAt: new Date(), callEnd: { reason: "user", roomSeconds: 148.2 } });
    expect(ended(150, [QUESTION], left, finished)).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false, callEnd: { reason: "user", roomSeconds: 148.2 } });
    // A drop is resumable as before: the start is not given back.
    expect(ended(150, [QUESTION], left, row({ callEnd: { reason: "disconnect" } }))).toMatchObject({ status: "IN_PROGRESS", earlyEnd: false, startRefunded: false, callEnd: { reason: "disconnect" } });
    expect(ended(150, [QUESTION], left)).toMatchObject({ callEnd: { reason: "disconnect" } });
  });

  it("gives the start back on an early end, so even the last start can be continued", () => {
    expect(ended(100, [QUESTION, END_CALL], "end_call tool was called.", row({ startCount: 3 }))).toMatchObject({ status: "IN_PROGRESS", startRefunded: true });
  });

  it("keeps each call's end on its segment when the interview is scored", () => {
    const first = { conversationId: "conv_0", turns: [{ role: "user", message: "First call.", time_in_call_secs: 3 }], durationSeconds: 100, startTimeSeconds: START - 400, end: { reason: "disconnect" as const, recorded: true } };
    const outcome = ended(190, [GOODBYE], "end_call tool was called.", row({ segments: [first] }));
    expect(outcome).toMatchObject({ status: "FEEDBACK_PENDING" });
    expect((outcome as { segments: { end?: { reason: string } }[] }).segments.map((segment) => segment.end?.reason)).toEqual(["disconnect", "interviewer"]);
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

  it("records a call the platform could not run as CALL_FAILED, not as a silent candidate, startable while starts remain", () => {
    const failed = payload({
      status: "failed",
      transcript: [],
      metadata: { start_time_unix_secs: START, call_duration_secs: 0, termination_reason: "", error: { code: 3000, reason: "[quota_exceeded] You've run out of credits." } },
    });

    expect(decide(row({ startCount: 1 }), failed)).toMatchObject({ kind: "store", status: "IN_PROGRESS", failureReason: CALL_FAILED, startRefunded: true });
    // Even at the cap: the start is given back, so the interview stays startable. The cap is for the candidate's connection, not the platform's outages.
    expect(decide(row({ startCount: 3 }), failed, 3)).toMatchObject({ kind: "store", status: "IN_PROGRESS", failureReason: CALL_FAILED, startRefunded: true });
    // What the candidate said still counts, however the platform labelled the call.
    expect(decide(row(), payload({ status: "failed" }))).toMatchObject({ kind: "store", status: "FEEDBACK_PENDING", failureReason: null, startRefunded: false });
    // A silent call the platform did run keeps its start: that was the candidate's microphone.
    expect(decide(row({ startCount: 1 }), payload({ transcript: [{ role: "agent", message: "Hi" }] }))).toMatchObject({ status: "IN_PROGRESS", failureReason: NO_CANDIDATE_TURNS, startRefunded: false });
    expect(platformFailure(toCallRecord(failed))).toBe("code=3000 [quota_exceeded] You've run out of credits.");
    expect(platformFailure(toCallRecord(payload()))).toBeNull();
    expect(platformFailure(toCallRecord(payload({ status: "failed", metadata: null })))).toBe("no reason given");
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

describe("callOverrunSeconds: a call that ran past what its session allowed", () => {
  it("reports only what passes the tolerance", () => {
    expect(CALL_OVERRUN_TOLERANCE_SECONDS).toBe(15);
    // A resumed call allowed 284 s that the room hung up three seconds late.
    expect(callOverrunSeconds(284, 287)).toBe(0);
    expect(callOverrunSeconds(284, 299)).toBe(0);
    expect(callOverrunSeconds(284, 299.6)).toBe(16);
    // A browser that never hung up: the agent's own limit ended it.
    expect(callOverrunSeconds(284, 720)).toBe(436);
  });

  it("says nothing when the allowance or the length is unknown (a row from before, a record without metadata)", () => {
    expect(callOverrunSeconds(null, 720)).toBe(0);
    expect(callOverrunSeconds(undefined, 720)).toBe(0);
    expect(callOverrunSeconds(284, null)).toBe(0);
  });
});

describe("isStranded", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const max = 720;
  const windowMs = (max + RECONCILE_GRACE_SECONDS) * 1000;
  const graceMs = RECONCILE_GRACE_SECONDS * 1000;
  const candidate = (overrides: Partial<StrandedCandidate> = {}): StrandedCandidate => ({
    status: "IN_PROGRESS",
    conversationId: "conv_1",
    hasTranscript: false,
    startedAt: new Date(now.getTime() - windowMs - 1),
    endedAt: null,
    ...overrides,
  });

  it("without an end time, is true only past the hard limit plus the grace, counted from the session issue", () => {
    expect(isStranded(candidate(), now, max)).toBe(true);
    expect(isStranded(candidate({ startedAt: new Date(now.getTime() - windowMs) }), now, max)).toBe(false);
    expect(isStranded(candidate({ startedAt: new Date(now.getTime() - 60_000) }), now, max)).toBe(false);
  });

  it("with the room's end time, is true from the grace after that moment, whatever the session age", () => {
    const recent = new Date(now.getTime() - 60_000);
    expect(isStranded(candidate({ startedAt: recent, endedAt: new Date(now.getTime() - graceMs - 1) }), now, max)).toBe(true);
    expect(isStranded(candidate({ startedAt: recent, endedAt: new Date(now.getTime() - graceMs) }), now, max)).toBe(true);
    expect(isStranded(candidate({ startedAt: recent, endedAt: new Date(now.getTime() - graceMs + 1) }), now, max)).toBe(false);
    // An old session whose call ended a moment ago is not stranded yet.
    expect(isStranded(candidate({ endedAt: new Date(now.getTime() - 30_000) }), now, max)).toBe(false);
  });

  it("with a grace of zero (the fast path for a call that ended at once), is true as soon as the room has reported the end", () => {
    const justNow = new Date(now.getTime() - 5_000);
    expect(isStranded(candidate({ startedAt: justNow, endedAt: now }), now, max, 0)).toBe(true);
    expect(isStranded(candidate({ startedAt: justNow, endedAt: new Date(now.getTime() - 1) }), now, max, 0)).toBe(true);
    // Without the room's report the fast path has nothing to go on: the hard limit still applies.
    expect(isStranded(candidate({ startedAt: justNow, endedAt: null }), now, max, 0)).toBe(false);
    expect(isStranded(candidate({ startedAt: justNow, endedAt: now, hasTranscript: true }), now, max, 0)).toBe(false);
  });

  it("is false without a session, with a transcript, or outside IN_PROGRESS", () => {
    expect(isStranded(candidate({ conversationId: null }), now, max)).toBe(false);
    expect(isStranded(candidate({ hasTranscript: true }), now, max)).toBe(false);
    expect(isStranded(candidate({ startedAt: null }), now, max)).toBe(false);
    expect(isStranded(candidate({ status: "FEEDBACK_PENDING" }), now, max)).toBe(false);
    expect(isStranded(candidate({ status: "SCHEDULED" }), now, max)).toBe(false);
  });
});

describe("fromConversationApi", () => {
  it("maps the API's record to the webhook's field names, turn for turn", () => {
    const data = fromConversationApi({
      agentId: "agent_1",
      conversationId: "conv_1",
      status: "done",
      transcript: [
        { role: "agent", message: "Hi.", timeInCallSecs: 0 },
        { role: "user", message: "Hello there.", timeInCallSecs: 4 },
        { role: "agent", message: undefined, timeInCallSecs: 9 },
      ],
      metadata: { startTimeUnixSecs: START, callDurationSecs: 300.5, terminationReason: "end_call tool" },
      conversationInitiationClientData: { dynamicVariables: { interview_id: "int_1" } },
    });

    expect(data).toEqual({
      agent_id: "agent_1",
      conversation_id: "conv_1",
      status: "done",
      transcript: [
        { role: "agent", message: "Hi.", time_in_call_secs: 0 },
        { role: "user", message: "Hello there.", time_in_call_secs: 4 },
        { role: "agent", message: null, time_in_call_secs: 9 },
      ],
      metadata: { start_time_unix_secs: START, call_duration_secs: 300.5, termination_reason: "end_call tool" },
      conversation_initiation_client_data: { dynamic_variables: { interview_id: "int_1" } },
    });
    // The result is what the webhook schema accepts, and the store decides on it the same way.
    expect(postCallTranscriptionSchema.safeParse(data).success).toBe(true);
    expect(decide(row({ conversationId: "conv_1" }), data)).toMatchObject({ kind: "store", status: "FEEDBACK_PENDING", durationSeconds: 301 });
  });

  it("keeps no initiation data when the API has none", () => {
    const data = fromConversationApi({
      agentId: "a",
      conversationId: "c",
      status: "failed",
      transcript: [],
      metadata: { startTimeUnixSecs: START, callDurationSecs: 0 },
    });
    expect(data.conversation_initiation_client_data).toBeNull();
    expect(data.metadata?.termination_reason).toBeNull();
    expect(data.metadata).not.toHaveProperty("error");
  });

  it("carries the platform's error: the record seen live when the agent could not start (the account out of credits)", () => {
    const data = fromConversationApi({
      agentId: "agent_1",
      conversationId: "conv_failed",
      status: "failed",
      transcript: [],
      metadata: {
        startTimeUnixSecs: START,
        callDurationSecs: 0,
        terminationReason: "",
        error: { code: 3000, reason: "[quota_exceeded] You've run out of credits. Add credits or upgrade your plan to start a new conversation." },
      },
      conversationInitiationClientData: { dynamicVariables: { ...ISSUED } },
    });

    expect(data.metadata).toEqual({
      start_time_unix_secs: START,
      call_duration_secs: 0,
      termination_reason: "",
      error: { code: 3000, reason: expect.stringContaining("[quota_exceeded]") },
    });
    expect(postCallTranscriptionSchema.safeParse(data).success).toBe(true);
    expect(decide(row({ conversationId: "conv_failed", startCount: 1 }), data)).toMatchObject({
      kind: "store",
      status: "IN_PROGRESS",
      failureReason: CALL_FAILED,
      contextMismatch: false,
      durationSeconds: 0,
      startRefunded: true,
    });
  });
});
