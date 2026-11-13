import { afterEach, describe, expect, it, vi } from "vitest";
import { agentConfigOverride, checkNextTurn, toRun, type NextTurnCheck } from "./simulate";

/** The platform's agent tests, stubbed: create, run, poll, delete. */
function serve(answers: { invocations: unknown[]; createStatus?: number }) {
  const calls: { method: string; path: string; body: unknown; key: string | null }[] = [];
  let polls = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: new Headers(init?.headers).get("xi-api-key") });
    if (method === "POST" && url.pathname === "/v1/convai/agent-testing/create") {
      return answers.createStatus
        ? Response.json({ detail: { status: "missing_permissions", message: "The API key you used is missing the permission convai_write to execute this operation." } }, { status: answers.createStatus })
        : Response.json({ id: "test_1" });
    }
    if (method === "POST" && url.pathname === "/v1/convai/agents/agent_full/run-tests") return Response.json(answers.invocations[0]);
    if (method === "GET" && url.pathname === "/v1/convai/test-invocations/inv_1") {
      polls += 1;
      return Response.json(answers.invocations[Math.min(polls, answers.invocations.length - 1)]);
    }
    if (method === "DELETE" && url.pathname === "/v1/convai/agent-testing/test_1") return Response.json({});
    return Response.json({ detail: "no stub" }, { status: 404 });
  });
  return calls;
}

const check: NextTurnCheck = {
  agentId: "agent_full",
  name: "resumed-call check",
  variables: { opening_line: "Welcome back, Ana.", call_context: "This call CONTINUES an interview." },
  history: [
    { role: "agent", message: "Welcome back, Ana." },
    { role: "user", message: "Sure, sorry about that." },
  ],
  condition: "The reply asks the pending question again.",
  passExample: "Before we were cut off I had asked how you tested it.",
  failExample: "How many years of React do you have?",
  repeat: 2,
};
const env = { ELEVENLABS_API_KEY: "test-key" };
const noWait = async () => {};

const pending = { id: "inv_1", test_runs: [{ status: "pending" }, { status: "pending" }] };
const finished = {
  id: "inv_1",
  test_runs: [
    { status: "passed", credits_used: 39, agent_responses: [{ role: "agent", message: " Before we were cut off I had asked how you tested it. " }], condition_result: { result: "success", rationale: { summary: "Asks the pending question." } } },
    { status: "failed", credits_used: 37, agent_responses: [{ role: "agent", message: "How many years of React do you have?" }, { role: "agent", message: null }], condition_result: { result: "failure", rationale: { summary: "Asks an answered question." } } },
  ],
};

describe("checkNextTurn: the interviewer's next turn, in text", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a test with the session's variables and the conversation so far, runs it, reads each run and deletes the test", async () => {
    const calls = serve({ invocations: [pending, pending, finished] });

    expect(await checkNextTurn(check, env, noWait)).toEqual([
      { said: "Before we were cut off I had asked how you tested it.", passed: true, why: "Asks the pending question.", credits: 39, endedCall: false, endReason: null, model: null },
      { said: "How many years of React do you have?", passed: false, why: "Asks an answered question.", credits: 37, endedCall: false, endReason: null, model: null },
    ]);

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /v1/convai/agent-testing/create",
      "POST /v1/convai/agents/agent_full/run-tests",
      "GET /v1/convai/test-invocations/inv_1",
      "GET /v1/convai/test-invocations/inv_1",
      "DELETE /v1/convai/agent-testing/test_1",
    ]);
    expect(calls.every((call) => call.key === "test-key")).toBe(true);
    expect(calls[0].body).toMatchObject({
      type: "llm",
      dynamic_variables: check.variables,
      chat_history: [
        { role: "agent", message: "Welcome back, Ana.", time_in_call_secs: 0 },
        { role: "user", message: "Sure, sorry about that.", time_in_call_secs: 8 },
      ],
      success_examples: [{ response: check.passExample, type: "success" }],
      failure_examples: [{ response: check.failExample, type: "failure" }],
    });
    expect(calls[1].body).toEqual({ tests: [{ test_id: "test_1" }], repeat_count: 2 });
  });

  it("sends a [time] note as the silent tool turn a call records, and can run another definition or model", async () => {
    const calls = serve({ invocations: [finished] });
    const override = { conversation_config: { agent: { prompt: { llm: "gpt-4o" } } }, platform_settings: {} };
    await checkNextTurn({ ...check, repeat: 1, history: [{ role: "agent", message: "What did you build?" }, { role: "note", message: "[time] About one minute remains." }], configOverride: override }, env, noWait);

    const history = (calls[0].body as { chat_history: Record<string, unknown>[] }).chat_history;
    expect(history.map((turn) => turn.role)).toEqual(["agent", "agent", "agent"]);
    expect(history[1]).toMatchObject({ message: null, tool_calls: [{ tool_name: "contextual_update", params_as_json: "{}" }] });
    expect(history[2]).toMatchObject({ message: null, tool_results: [{ tool_name: "contextual_update", result_value: "[time] About one minute remains." }] });
    expect(calls[1].body).toEqual({ tests: [{ test_id: "test_1" }], agent_config_override: override });
  });

  it("sends an end_interview call and the room's answer as the client tool turns a call records", async () => {
    const calls = serve({ invocations: [finished] });
    const refusal = "REFUSED: the call continues. The interview time is not up: 1 min 6 s remain.";
    await checkNextTurn({ ...check, repeat: 1, history: [{ role: "agent", message: "What did you build?" }, { role: "user", message: "A billing service." }, { role: "tool", reason: "time_up", result: refusal }] }, env, noWait);

    const history = (calls[0].body as { chat_history: Record<string, unknown>[] }).chat_history;
    expect(history.map((turn) => turn.role)).toEqual(["agent", "user", "agent", "agent"]);
    expect(history[2]).toMatchObject({ message: null, time_in_call_secs: 16, tool_calls: [{ type: "client", tool_name: "end_interview", params_as_json: JSON.stringify({ reason: "time_up" }) }] });
    expect(history[3]).toMatchObject({ message: null, tool_results: [{ type: "client", tool_name: "end_interview", result_value: refusal, is_error: false }] });
    // The call and its answer share one request id.
    const requestId = (history[2].tool_calls as { request_id: string }[])[0].request_id;
    expect((history[3].tool_results as { request_id: string }[])[0].request_id).toBe(requestId);
  });

  it("fails a run in code when the room is asked where it must not be, whatever the judge said", async () => {
    const run = (turns: unknown[], status = "passed") => ({ id: "inv_1", test_runs: [{ status, credits_used: 40, agent_responses: turns, condition_result: { rationale: { summary: "Looks right." } } }] });
    const ask = (reason: string) => ({ role: "agent", message: null, tool_calls: [{ tool_name: "end_interview", params_as_json: JSON.stringify({ reason }) }] });
    const question = { role: "agent", message: "And how would you let the team know?", producing_llm: "gemini-3.5-flash" };

    serve({ invocations: [run([question, ask("time_up")])] });
    expect(await checkNextTurn({ ...check, repeat: 1, endTool: "forbidden" }, env, noWait)).toEqual([
      { said: "And how would you let the team know?", passed: false, why: "end_interview was called in this turn; the judge: Looks right.", credits: 40, endedCall: true, endReason: "time_up", model: "gemini-3.5-flash" },
    ]);
    // A question with no request passes when the judge passed it, and fails with the judge otherwise.
    serve({ invocations: [run([question])] });
    expect(await checkNextTurn({ ...check, repeat: 1, endTool: "forbidden" }, env, noWait)).toMatchObject([{ passed: true, endedCall: false, endReason: null }]);
    serve({ invocations: [run([question], "failed")] });
    expect(await checkNextTurn({ ...check, repeat: 1, endTool: "forbidden" }, env, noWait)).toMatchObject([{ passed: false, why: "Looks right." }]);
    // The platform's old tool is not the room's: it does not count as asking.
    serve({ invocations: [run([question, { role: "agent", message: null, tool_calls: [{ tool_name: "end_call", params_as_json: "{}" }] }])] });
    expect(await checkNextTurn({ ...check, repeat: 1, endTool: "forbidden" }, env, noWait)).toMatchObject([{ passed: true, endedCall: false }]);
  });

  it("deletes the test even when the run never finishes", async () => {
    const calls = serve({ invocations: [pending] });
    await expect(checkNextTurn(check, env, noWait)).rejects.toThrow(/did not finish/);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/v1/convai/agent-testing/test_1" });
  });

  it("names the permission the platform names, and asks for the key before anything else", async () => {
    serve({ invocations: [], createStatus: 401 });
    await expect(checkNextTurn(check, env, noWait)).rejects.toThrow(/HTTP 401 \(missing_permissions\).*convai_write/);
    await expect(checkNextTurn(check, {}, noWait)).rejects.toThrow(/ELEVENLABS_API_KEY is not set/);
  });
});

describe("toRun: a turn that must ask the room to end the call", () => {
  const ask = (reason: unknown) => ({ role: "agent", message: null, tool_calls: [{ tool_name: "end_interview", params_as_json: JSON.stringify({ reason }) }] });
  const goodbye = { role: "agent", message: "Thanks for practicing. Your feedback will appear on your screen in a moment." };
  // The judge reads the goodbye; whether the room was asked, and why, is read in code.
  const run = (turns: unknown[], status = "passed") => ({ status, credits_used: 21, agent_responses: turns as never, condition_result: { rationale: { summary: "Nothing was said." } } });

  it("passes the goodbye said in the same turn as the call, with the right reason", () => {
    expect(toRun(run([goodbye, ask("time_up")]), "time_up")).toEqual({ said: goodbye.message, passed: true, why: "Nothing was said.", credits: 21, endedCall: true, endReason: "time_up", model: null });
    expect(toRun(run([goodbye, ask("candidate_confirmed")]), "candidate_confirmed")).toMatchObject({ passed: true, endReason: "candidate_confirmed" });
    // The judge still decides on the words: a goodbye it rejects (a "we", a next step) fails the run.
    expect(toRun(run([goodbye, ask("time_up")], "failed"), "time_up")).toMatchObject({ passed: false, endedCall: true });
  });

  it("fails when the room was not asked, or with the other reason, or with unreadable parameters", () => {
    expect(toRun(run([goodbye], "passed"), "time_up")).toMatchObject({ passed: false, endedCall: false, why: "end_interview was not called; the judge: Nothing was said." });
    expect(toRun(run([ask("candidate_confirmed")]), "time_up")).toMatchObject({ passed: false, why: expect.stringContaining("end_interview was called with reason candidate_confirmed, not time_up") });
    expect(toRun(run([ask("time_up")]), "candidate_confirmed")).toMatchObject({ passed: false });
    expect(toRun(run([ask(7)]), "time_up")).toMatchObject({ passed: false, endReason: null, why: expect.stringContaining("with reason (none)") });
    expect(toRun(run([{ role: "agent", message: null, tool_calls: [{ tool_name: "end_interview", params_as_json: "{" }] }]), "time_up")).toMatchObject({ passed: false, endedCall: true, endReason: null });
  });

  it("fails a call with no goodbye in its turn, or with a question in it: the room hangs up when that turn has been spoken", () => {
    expect(toRun(run([ask("time_up")]), "time_up")).toMatchObject({ passed: false, endedCall: true, why: expect.stringContaining("end_interview without the spoken goodbye") });
    expect(toRun(run([{ role: "agent", message: "Understood." }, ask("time_up")]), "time_up")).toMatchObject({ passed: false });
    expect(toRun(run([{ role: "agent", message: `${goodbye.message} ¿Algo más que quieras agregar?` }, ask("time_up")]), "time_up")).toMatchObject({
      passed: false,
      why: expect.stringContaining("also asked something"),
    });
  });

  it("leaves a check with no tool expectation to the judge alone", () => {
    expect(toRun(run([goodbye, ask("time_up")], "passed"), undefined)).toMatchObject({ passed: true, endedCall: true, endReason: "time_up" });
    expect(toRun(run([goodbye], "failed"), undefined)).toMatchObject({ passed: false });
  });
});

describe("agentConfigOverride", () => {
  it("is this checkout's definition in the API's spelling, with the room's tool attached and no end_call", () => {
    const wire = agentConfigOverride("TRIAL", { endToolId: "tool_end_1" }) as { conversation_config: { agent: { prompt: { llm: string; tool_ids: string[]; built_in_tools: object } }; conversation: { max_duration_seconds: number }; turn: { turn_timeout: number } } };
    expect(wire.conversation_config.agent.prompt.tool_ids).toEqual(["tool_end_1"]);
    // Sent as null: an agent update merges, and leaving end_call out would keep it.
    expect(wire.conversation_config.agent.prompt.built_in_tools).toEqual({ end_call: null });
    expect(wire.conversation_config.conversation.max_duration_seconds).toBe(360);
    expect(wire.conversation_config.turn.turn_timeout).toBe(12);
    // Another model for this run only; without the tool id the override would detach the tool.
    const backup = agentConfigOverride("FULL", { llm: "gpt-4o", endToolId: "tool_end_1" }) as typeof wire;
    expect(backup.conversation_config.agent.prompt.llm).toBe("gpt-4o");
    expect((agentConfigOverride("FULL") as typeof wire).conversation_config.agent.prompt.tool_ids).toEqual([]);
  });
});
