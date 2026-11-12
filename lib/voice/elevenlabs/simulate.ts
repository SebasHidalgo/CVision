/** The interviewer's next turn, checked in text with no call, through the platform's agent tests (about 40 credits a run). */

const API = "https://api.elevenlabs.io";

export type NextTurnCheck = {
  agentId: string;
  /** Shown in the platform's test list while the run lasts. */
  name: string;
  /** The session's variables, exactly as the server would issue them. */
  variables: Record<string, string>;
  /** The conversation so far, oldest first; the agent writes the turn after it. */
  history: { role: "agent" | "user"; message: string }[];
  /** What the next turn must do, for the judge. */
  condition: string;
  /** One reply that meets the condition and one that does not: the judge needs both. */
  passExample: string;
  failExample: string;
  /** How many times the agent answers; the model is not deterministic. */
  repeat?: number;
};

export type NextTurnRun = {
  /** What the agent wrote. */
  said: string;
  passed: boolean;
  /** The judge's reason. */
  why: string | null;
  credits: number | null;
};

const POLL_MS = 3_000;
const POLL_LIMIT = 60;

async function call(method: string, path: string, body: unknown, env: Record<string, string | undefined>): Promise<Record<string, unknown>> {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set (see .env.template)");
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": apiKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = (answer?.detail ?? {}) as { status?: string; message?: string };
    // The platform's own words name a missing permission; nothing in them is secret.
    throw new Error(`ElevenLabs answered HTTP ${response.status}${detail.status ? ` (${detail.status})` : ""}${detail.message ? `: ${detail.message}` : ""}`);
  }
  return answer ?? {};
}

type WireRun = {
  status?: string;
  credits_used?: number | null;
  agent_responses?: { role?: string; message?: string | null }[] | null;
  condition_result?: { result?: string; rationale?: { summary?: string } | null } | null;
};

function toRun(run: WireRun): NextTurnRun {
  const said = (run.agent_responses ?? [])
    .filter((turn) => turn.role === "agent" && typeof turn.message === "string" && turn.message.trim() !== "")
    .map((turn) => (turn.message ?? "").trim())
    .join(" ");
  return {
    said,
    passed: run.status === "passed",
    why: run.condition_result?.rationale?.summary ?? null,
    credits: typeof run.credits_used === "number" ? run.credits_used : null,
  };
}

/** Runs the check and returns one result per repeat. Spends credits (the agent's LLM and the judge's). */
export async function checkNextTurn(check: NextTurnCheck, env: Record<string, string | undefined> = process.env, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<NextTurnRun[]> {
  const created = await call(
    "POST",
    "/v1/convai/agent-testing/create",
    {
      type: "llm",
      name: check.name,
      dynamic_variables: check.variables,
      chat_history: check.history.map((turn, index) => ({ role: turn.role, message: turn.message, time_in_call_secs: index * 8 })),
      success_condition: `Return True when: ${check.condition} Return False otherwise.`,
      success_examples: [{ response: check.passExample, type: "success" }],
      failure_examples: [{ response: check.failExample, type: "failure" }],
    },
    env,
  );
  const testId = typeof created.id === "string" ? created.id : null;
  if (!testId) throw new Error("ElevenLabs created the test without an id");

  try {
    const repeat = Math.max(1, Math.floor(check.repeat ?? 1));
    let invocation = await call("POST", `/v1/convai/agents/${encodeURIComponent(check.agentId)}/run-tests`, { tests: [{ test_id: testId }], ...(repeat > 1 ? { repeat_count: repeat } : {}) }, env);
    const invocationId = typeof invocation.id === "string" ? invocation.id : null;
    if (!invocationId) throw new Error("ElevenLabs started the run without an id");
    const runs = () => (Array.isArray(invocation.test_runs) ? (invocation.test_runs as WireRun[]) : []);
    for (let polls = 0; polls < POLL_LIMIT && runs().some((run) => run.status === "pending"); polls += 1) {
      await wait(POLL_MS);
      invocation = await call("GET", `/v1/convai/test-invocations/${encodeURIComponent(invocationId)}`, undefined, env);
    }
    if (runs().some((run) => run.status === "pending")) throw new Error("the test run did not finish in three minutes");
    return runs().map(toRun);
  } finally {
    // Best effort: a test left behind costs nothing and is named, so it can be deleted by hand.
    await call("DELETE", `/v1/convai/agent-testing/${encodeURIComponent(testId)}`, undefined, env).catch(() => undefined);
  }
}
