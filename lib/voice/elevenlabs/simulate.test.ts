import { afterEach, describe, expect, it, vi } from "vitest";
import { checkNextTurn, type NextTurnCheck } from "./simulate";

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
      { said: "Before we were cut off I had asked how you tested it.", passed: true, why: "Asks the pending question.", credits: 39, endedCall: false, model: null },
      { said: "How many years of React do you have?", passed: false, why: "Asks an answered question.", credits: 37, endedCall: false, model: null },
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

  it("fails a run in code when end_call is called where it must not be, or missing where it must be, whatever the judge said", async () => {
    const run = (turns: unknown[]) => ({ id: "inv_1", test_runs: [{ status: "passed", credits_used: 40, agent_responses: turns, condition_result: { rationale: { summary: "Looks right." } } }] });
    const hangUp = { role: "agent", message: null, tool_calls: [{ tool_name: "end_call", params_as_json: "{}" }] };
    const question = { role: "agent", message: "Do you want to end the interview now?", producing_llm: "gemini-3.5-flash" };
    const goodbye = { role: "agent", message: "Thanks for practicing. Your feedback will appear on your screen in a moment." };

    serve({ invocations: [run([question, hangUp])] });
    expect(await checkNextTurn({ ...check, repeat: 1, endCall: "forbidden" }, env, noWait)).toEqual([
      { said: "Do you want to end the interview now?", passed: false, why: "end_call was called in this turn; the judge: Looks right.", credits: 40, endedCall: true, model: "gemini-3.5-flash" },
    ]);
    serve({ invocations: [run([goodbye])] });
    expect(await checkNextTurn({ ...check, repeat: 1, endCall: "required" }, env, noWait)).toMatchObject([{ passed: false, why: "end_call was not called; the judge: Looks right." }]);
    serve({ invocations: [run([hangUp])] });
    expect(await checkNextTurn({ ...check, repeat: 1, endCall: "required" }, env, noWait)).toMatchObject([{ passed: false, why: "end_call without a spoken goodbye; the judge: Looks right." }]);
    serve({ invocations: [run([goodbye, hangUp])] });
    expect(await checkNextTurn({ ...check, repeat: 1, endCall: "required" }, env, noWait)).toMatchObject([{ passed: true, endedCall: true }]);
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
