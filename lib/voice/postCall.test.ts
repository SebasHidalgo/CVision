import { describe, expect, it } from "vitest";
import { INTERVIEW_GRACE_SECONDS } from "@/lib/interviewLimits";
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
  it("reports only what passes the tolerance: the grace and a margin", () => {
    expect(CALL_OVERRUN_TOLERANCE_SECONDS).toBe(75);
    // A resumed call allowed 284 s that used its grace and was hung up three seconds late.
    expect(callOverrunSeconds(284, 287)).toBe(0);
    expect(callOverrunSeconds(284, 347)).toBe(0);
    expect(callOverrunSeconds(284, 359)).toBe(0);
    expect(callOverrunSeconds(284, 359.6)).toBe(76);
    // A browser that never hung up: the agent's own limit ended it.
    expect(callOverrunSeconds(284, 780)).toBe(496);
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

// A request to the room and its answer, the way the record carries a client tool.
const askedRoom = (reason: string, answer: string | null, at = 230, id = "req_1") => [
  { role: "agent", message: null, time_in_call_secs: at, tool_calls: [{ tool_name: "end_interview", params_as_json: JSON.stringify({ reason }), request_id: id }] },
  ...(answer === null ? [] : [{ role: "agent", message: null, time_in_call_secs: at, tool_results: [{ tool_name: "end_interview", result_value: answer, request_id: id }] }]),
];
const ALLOWED = "ALLOWED: the room hangs up when you finish speaking. Say the goodbye now.";
const REFUSED = "REFUSED: the call continues. The interview time is not up: 1 min 6 s remain.";
const CLIENT_LEFT = "Client disconnected: 1005";

describe("toCallRecord: what the tool turns say, and what is kept of a turn", () => {
  const record = (transcript: PostCallTranscription["transcript"]) => toCallRecord(payload({ transcript, metadata: { start_time_unix_secs: START, call_duration_secs: 240, termination_reason: CLIENT_LEFT } }));

  it("reads the last end_interview call: refused only when the room's answer says so", () => {
    expect(record([...payload().transcript, ...askedRoom("time_up", ALLOWED)]).endTool).toEqual({ reason: "time_up", refused: false });
    expect(record([...payload().transcript, ...askedRoom("candidate_confirmed", `  ${ALLOWED}`)]).endTool).toEqual({ reason: "candidate_confirmed", refused: false });
    expect(record([...payload().transcript, ...askedRoom("time_up", REFUSED)]).endTool).toEqual({ reason: "time_up", refused: true });
    expect(record([...payload().transcript, ...askedRoom("time_up", `  ${REFUSED}`)]).endTool).toEqual({ reason: "time_up", refused: true });
    // The room answers every refusal at once and hangs up on a call it allows, usually before any answer is recorded.
    expect(record([...payload().transcript, ...askedRoom("time_up", null)]).endTool).toEqual({ reason: "time_up", refused: false });
    expect(record(payload().transcript).endTool).toBeNull();
  });

  it("takes the last request when there were several, each with its own answer", () => {
    const turns = [...payload().transcript, ...askedRoom("time_up", REFUSED, 200, "req_1"), { role: "agent", message: "What did you do next?", time_in_call_secs: 204 }, { role: "user", message: "I wrote the fix.", time_in_call_secs: 215 }, ...askedRoom("time_up", ALLOWED, 301, "req_2")];
    expect(record(turns).endTool).toEqual({ reason: "time_up", refused: false });
    // The other way round: an allowed answer to an earlier request does not allow the last one.
    const reversed = [...payload().transcript, ...askedRoom("time_up", ALLOWED, 200, "req_1"), ...askedRoom("candidate_confirmed", REFUSED, 301, "req_2")];
    expect(record(reversed).endTool).toEqual({ reason: "candidate_confirmed", refused: true });
  });

  it("reads an unknown reason or unreadable parameters as time_up, and ignores other tools", () => {
    expect(record([...payload().transcript, ...askedRoom("whenever", ALLOWED)]).endTool).toEqual({ reason: "time_up", refused: false });
    const broken = [{ role: "agent", message: null, tool_calls: [{ tool_name: "end_interview", params_as_json: "{", request_id: "req_9" }] }];
    expect(record([...payload().transcript, ...broken]).endTool).toEqual({ reason: "time_up", refused: false });
    const note = [{ role: "agent", message: null, tool_calls: [{ tool_name: "contextual_update", params_as_json: "{}", request_id: "n_1" }] }, { role: "agent", message: null, tool_results: [{ tool_name: "contextual_update", result_value: "ALLOWED", request_id: "n_1" }] }];
    expect(record([...payload().transcript, ...note]).endTool).toBeNull();
  });

  it("counts the turns the backup model answered: one per run of interviewer entries it wrote, and names the models", () => {
    const turns = [
      { role: "agent", message: "Welcome.", time_in_call_secs: 0 },
      { role: "user", message: "Hello.", time_in_call_secs: 3 },
      // One turn: its words and its tool entry both carry the mark.
      { role: "agent", message: "Tell me about your last project.", time_in_call_secs: 5, llm_override: "gpt-4o" },
      { role: "agent", message: null, time_in_call_secs: 6, llm_override: "gpt-4o", tool_calls: [{ tool_name: "contextual_update", params_as_json: "{}" }] },
      { role: "user", message: "It was a billing service.", time_in_call_secs: 12 },
      { role: "agent", message: "What was hard about it?", time_in_call_secs: 20 },
      { role: "user", message: "The retries.", time_in_call_secs: 26, llm_override: "ignored on a candidate turn" },
      { role: "agent", message: "And how did you test them?", time_in_call_secs: 30, llm_override: " gpt-4o-mini " },
    ];
    const read = record(turns);
    expect(read.backupTurns).toBe(2);
    expect(read.backupModels).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(record(payload().transcript)).toMatchObject({ backupTurns: 0, backupModels: [] });
  });

  it("keeps of each turn only who spoke, what, and when, and drops the turns without words", () => {
    const turns = [
      { role: "agent", message: "Welcome.", time_in_call_secs: 0, llm_override: "gpt-4o", agent_metadata: { agent_id: "agent_1" }, conversation_turn_metrics: { metrics: { ttfb: 0.4 } }, interrupted: false, source_medium: "audio", feedback: null },
      { role: "user", message: "Hello.", time_in_call_secs: 3, llm_usage: null, rag_retrieval_info: null, original_message: "Hello" },
      ...askedRoom("time_up", REFUSED, 5),
      { role: "agent", message: "   ", time_in_call_secs: 6 },
      { role: "user", message: "No timestamp on this one." },
    ];
    const kept = record(turns).turns;
    expect(kept).toEqual([
      { role: "agent", message: "Welcome.", time_in_call_secs: 0 },
      { role: "user", message: "Hello.", time_in_call_secs: 3 },
      { role: "user", message: "No timestamp on this one." },
    ]);
    for (const turn of kept) expect(Object.keys(turn).every((key) => ["role", "message", "time_in_call_secs"].includes(key))).toBe(true);
  });
});

describe("the grace: a call may run past its paid length", () => {
  it("reports an overrun only past the grace plus fifteen seconds", () => {
    expect(INTERVIEW_GRACE_SECONDS).toBe(60);
    expect(CALL_OVERRUN_TOLERANCE_SECONDS).toBe(INTERVIEW_GRACE_SECONDS + 15);
    // A five-minute trial that used its grace in full, and the platform's own cut a second later.
    expect(callOverrunSeconds(300, 360)).toBe(0);
    expect(callOverrunSeconds(300, 361)).toBe(0);
    expect(callOverrunSeconds(300, 375)).toBe(0);
    expect(callOverrunSeconds(300, 376)).toBe(76);
    // A resumed call allowed 120 s that the room never hung up: the platform's limit ended it.
    expect(callOverrunSeconds(120, 360)).toBe(240);
  });
});

describe("decidePostCallOutcome: only the room hangs up", () => {
  // A five-minute trial that ended after `seconds` with the client leaving, with these last turns.
  const ended = (seconds: number, last: PostCallTranscription["transcript"], r: PostCallRow = row(), reason = CLIENT_LEFT) =>
    decidePostCallOutcome({
      row: r,
      data: toCallRecord(payload({ transcript: [...payload().transcript, ...last], metadata: { start_time_unix_secs: START, call_duration_secs: seconds, termination_reason: reason } })),
      eventTimestamp: START + 500,
      maxStarts: 3,
      plannedSeconds: 300,
      now: new Date((START + seconds + 5) * 1000),
    });
  const GOODBYE = { role: "agent", message: "Thanks for practicing, Ana. Your feedback will appear on your screen in a moment.", time_in_call_secs: 236 };
  const QUESTION = { role: "agent", message: "Tell me about a project you led, and what your part in it was.", time_in_call_secs: 150 };
  const ANSWER = { role: "user", message: "I led the move to the new billing service.", time_in_call_secs: 228 };

  it("today's shape: a goodbye allowed at 3:54 of 5:00 is early: not scored, resumable, its start given back", () => {
    const outcome = ended(234, [QUESTION, ANSWER, ...askedRoom("time_up", ALLOWED), GOODBYE]);
    expect(outcome).toMatchObject({ kind: "store", status: "IN_PROGRESS", earlyEnd: true, startRefunded: true, failureReason: null, callEnd: { reason: "interviewer", detail: "time_up", recorded: true } });
    expect((outcome as { resumableUntil: Date | null }).resumableUntil).toEqual(new Date((START + 234 + 600) * 1000));
    // The transcript stored is this call's, without the tool turns; nothing is merged for scoring yet.
    expect((outcome as { transcript: { message?: string | null }[] }).transcript.at(-1)?.message).toBe(GOODBYE.message);
    // On the last start too: the connection comes back, so it can be continued.
    expect(ended(234, [QUESTION, ANSWER, ...askedRoom("time_up", ALLOWED), GOODBYE], row({ startCount: 3 }))).toMatchObject({ status: "IN_PROGRESS", startRefunded: true });
  });

  it("scores the interview when the room allowed the end after the paid time was over, inside the grace", () => {
    for (const seconds of [300, 318, 359]) {
      expect(ended(seconds, [QUESTION, ANSWER, ...askedRoom("time_up", ALLOWED, seconds - 12), GOODBYE])).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false, startRefunded: false, resumableUntil: null, durationSeconds: seconds, callEnd: { reason: "interviewer", detail: "time_up" } });
    }
  });

  it("scores a stop the candidate confirmed, however much time was left", () => {
    const confirmed = [QUESTION, { role: "user", message: "Sorry, can we stop here?", time_in_call_secs: 160 }, { role: "agent", message: "Do you want to end the interview now?", time_in_call_secs: 163 }, { role: "user", message: "Yes.", time_in_call_secs: 166 }, ...askedRoom("candidate_confirmed", ALLOWED, 168), GOODBYE];
    expect(ended(176, confirmed)).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false, startRefunded: false, callEnd: { reason: "interviewer", detail: "confirmed" } });
  });

  it("keeps a call whose request the room refused as a drop: resumable, the start not given back", () => {
    expect(ended(240, [QUESTION, ANSWER, ...askedRoom("time_up", REFUSED)])).toMatchObject({ status: "IN_PROGRESS", earlyEnd: false, startRefunded: false, callEnd: { reason: "disconnect", detail: CLIENT_LEFT } });
    // A plain disconnect over a pending question: the same.
    expect(ended(150, [QUESTION])).toMatchObject({ status: "IN_PROGRESS", earlyEnd: false, startRefunded: false, callEnd: { reason: "disconnect" } });
    // An unanswered time_up with paid time left is a call the room should not have ended: early, never scored.
    expect(ended(240, [QUESTION, ANSWER, ...askedRoom("time_up", null)])).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true, startRefunded: true, callEnd: { reason: "interviewer", detail: "time_up" } });
  });

  it("treats a platform-side end with paid time left as early, whoever spoke last", () => {
    for (const last of [[QUESTION], [QUESTION, ANSWER]]) {
      expect(ended(200, last, row(), "Call ended due to silence timeout")).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true, startRefunded: true, callEnd: { reason: "platform", detail: "Call ended due to silence timeout" } });
    }
  });

  it("lets the candidate's End or Finish stand over anything", () => {
    const finished = row({ finishRequestedAt: new Date(), callEnd: { reason: "user", roomSeconds: 120.4 } });
    expect(ended(121, [QUESTION], finished)).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false, startRefunded: false, callEnd: { reason: "user", roomSeconds: 120.4 } });
    expect(ended(234, [QUESTION, ANSWER, ...askedRoom("time_up", ALLOWED), GOODBYE], row({ finishRequestedAt: new Date() }))).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false });
  });

  it("lets any end stand with 30 s or less of paid time left: nothing is left to resume", () => {
    expect(ended(271, [QUESTION, ANSWER, ...askedRoom("time_up", ALLOWED), GOODBYE])).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false });
    expect(ended(275, [QUESTION], row(), "Call ended due to silence timeout")).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false, callEnd: { reason: "platform" } });
    expect(ended(275, [QUESTION])).toMatchObject({ status: "FEEDBACK_PENDING", callEnd: { reason: "disconnect" } });
    // One second more of paid time left and each of them is resumable.
    expect(ended(269, [QUESTION, ANSWER, ...askedRoom("time_up", ALLOWED), GOODBYE])).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true });
    expect(ended(269, [QUESTION], row(), "Call ended due to silence timeout")).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true });
  });

  it("scores a call the platform cut at the paid length plus the grace", () => {
    expect(ended(360, [QUESTION, ANSWER], row(), "Maximum duration exceeded")).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false, durationSeconds: 360, callEnd: { reason: "limit" } });
  });

  it("falls back to what the room said it allowed when the record lost the tool turn", () => {
    const confirmed = row({ callEnd: { reason: "interviewer", detail: "confirmed", roomSeconds: 175.2 } });
    expect(ended(176, [QUESTION, GOODBYE], confirmed)).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false, callEnd: { reason: "interviewer", detail: "confirmed", roomSeconds: 175.2, recorded: true } });
    // A time_up the room claims with paid time left is as early as one the record shows.
    const timeUp = row({ callEnd: { reason: "interviewer", detail: "time_up", roomSeconds: 233 } });
    expect(ended(234, [QUESTION, ANSWER, GOODBYE], timeUp)).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true, startRefunded: true, callEnd: { reason: "interviewer", detail: "time_up" } });
    // The claim counts only when the client left: a platform-side end is the platform's.
    expect(ended(200, [QUESTION], confirmed, "Call ended due to silence timeout")).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true, callEnd: { reason: "platform" } });
    // A claim without one of the two details is not an end by the interviewer.
    expect(ended(176, [QUESTION, GOODBYE], row({ callEnd: { reason: "interviewer" } }))).toMatchObject({ status: "IN_PROGRESS", earlyEnd: false, callEnd: { reason: "disconnect" } });
  });

  it("still classifies a record of the old end_call tool by the goodbye's words", () => {
    const OLD_END = "end_call tool was called.";
    expect(ended(250, [QUESTION, ANSWER, GOODBYE], row(), OLD_END)).toMatchObject({ status: "FEEDBACK_PENDING", earlyEnd: false, callEnd: { reason: "interviewer" } });
    expect(ended(178, [QUESTION, ANSWER, GOODBYE], row(), OLD_END)).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true });
    expect(ended(235, [QUESTION], row(), OLD_END)).toMatchObject({ status: "IN_PROGRESS", earlyEnd: true, startRefunded: true });
  });

  it("carries the count of backup-model turns on the stored end", () => {
    const outcome = ended(318, [{ ...QUESTION, llm_override: "gpt-4o" }, ANSWER, ...askedRoom("time_up", ALLOWED, 306), GOODBYE]);
    expect(outcome).toMatchObject({ status: "FEEDBACK_PENDING", callEnd: { reason: "interviewer", detail: "time_up", backupTurns: 1 } });
    expect((ended(318, [QUESTION, ANSWER, ...askedRoom("time_up", ALLOWED, 306), GOODBYE]) as { callEnd: object }).callEnd).not.toHaveProperty("backupTurns");
  });
});
