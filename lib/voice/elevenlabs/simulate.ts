/** The interviewer's next turn, checked in text with no call, through the platform's agent tests (about 40 credits a run). */

import type { InterviewTierId } from "@/lib/plans";
import { buildInterviewAgentDefinition } from "./agentConfig";

const API = "https://api.elevenlabs.io";

/** The definition in the API's spelling: camelCase keys to snake_case, values untouched. */
function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), toWire(inner)]));
}

/** This checkout's agent definition for one test run, optionally on another model (the backup). */
export function agentConfigOverride(tier: InterviewTierId, { llm }: { llm?: string } = {}): NonNullable<NextTurnCheck["configOverride"]> {
  const definition = buildInterviewAgentDefinition({ postCallWebhookId: null, tier });
  const wire = toWire({ conversationConfig: definition.conversationConfig, platformSettings: definition.platformSettings }) as { conversation_config: { agent: { prompt: { llm: string } } }; platform_settings: unknown };
  if (llm) wire.conversation_config.agent.prompt.llm = llm;
  return wire;
}

export type NextTurnCheck = {
  agentId: string;
  /** Shown in the platform's test list while the run lasts. */
  name: string;
  /** The session's variables, exactly as the server would issue them. */
  variables: Record<string, string>;
  /** The conversation so far, oldest first; the agent writes the turn after it. A "note" is a silent [time] line. */
  history: { role: "agent" | "user" | "note"; message: string }[];
  /** What the next turn must do, for the judge. */
  condition: string;
  /** One reply that meets the condition and one that does not: the judge needs both. */
  passExample: string;
  failExample: string;
  /** How many times the agent answers; the model is not deterministic. */
  repeat?: number;
  /** Checked in code, not by the judge: the turn must, or must not, call end_call. */
  endCall?: "required" | "forbidden";
  /** The agent's full configuration for this run only: a backup model, or a definition not yet synced. */
  configOverride?: { conversation_config: unknown; platform_settings: unknown };
};

export type NextTurnRun = {
  /** What the agent wrote. */
  said: string;
  passed: boolean;
  /** The judge's reason, or the code check that failed. */
  why: string | null;
  credits: number | null;
  /** The turn called the end_call tool. */
  endedCall: boolean;
  /** The model that wrote the turn, as the platform reports it. */
  model: string | null;
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
  agent_responses?: { role?: string; message?: string | null; producing_llm?: string | null; tool_calls?: { tool_name?: string | null }[] | null }[] | null;
  condition_result?: { result?: string; rationale?: { summary?: string } | null } | null;
};

function toRun(run: WireRun, endCall: NextTurnCheck["endCall"]): NextTurnRun {
  const turns = run.agent_responses ?? [];
  const said = turns
    .filter((turn) => turn.role === "agent" && typeof turn.message === "string" && turn.message.trim() !== "")
    .map((turn) => (turn.message ?? "").trim())
    .join(" ");
  const endedCall = turns.some((turn) => (turn.tool_calls ?? []).some((call) => call.tool_name === "end_call"));
  // The judge reads the words; whether the call was ended is a fact.
  const broken = endCall === "forbidden" && endedCall ? "end_call was called in this turn" : endCall === "required" && !endedCall ? "end_call was not called" : endCall === "required" && !said ? "end_call without a spoken goodbye" : null;
  const judged = run.condition_result?.rationale?.summary ?? null;
  return {
    said,
    passed: run.status === "passed" && broken === null,
    why: broken ? `${broken}${judged ? `; the judge: ${judged}` : ""}` : judged,
    credits: typeof run.credits_used === "number" ? run.credits_used : null,
    endedCall,
    model: turns.find((turn) => typeof turn.producing_llm === "string" && turn.producing_llm)?.producing_llm ?? null,
  };
}

/** A [time] line the way a call records it: a contextual_update tool turn and its result. */
function noteTurns(text: string, index: number) {
  const id = `contextual_update_${String(index).padStart(8, "0")}`;
  return [
    { role: "agent", message: null, tool_calls: [{ type: "system", request_id: id, tool_name: "contextual_update", params_as_json: "{}", tool_has_been_called: true }] },
    { role: "agent", message: null, tool_results: [{ type: "system", request_id: id, tool_name: "contextual_update", result_value: text, is_error: false, tool_has_been_called: true, tool_latency_secs: 0 }] },
  ];
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
      chat_history: check.history.flatMap((turn, index) =>
        (turn.role === "note" ? noteTurns(turn.message, index) : [{ role: turn.role, message: turn.message }]).map((wire) => ({ ...wire, time_in_call_secs: index * 8 })),
      ),
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
    let invocation = await call("POST", `/v1/convai/agents/${encodeURIComponent(check.agentId)}/run-tests`, { tests: [{ test_id: testId }], ...(repeat > 1 ? { repeat_count: repeat } : {}), ...(check.configOverride ? { agent_config_override: check.configOverride } : {}) }, env);
    const invocationId = typeof invocation.id === "string" ? invocation.id : null;
    if (!invocationId) throw new Error("ElevenLabs started the run without an id");
    const runs = () => (Array.isArray(invocation.test_runs) ? (invocation.test_runs as WireRun[]) : []);
    for (let polls = 0; polls < POLL_LIMIT && runs().some((run) => run.status === "pending"); polls += 1) {
      await wait(POLL_MS);
      invocation = await call("GET", `/v1/convai/test-invocations/${encodeURIComponent(invocationId)}`, undefined, env);
    }
    if (runs().some((run) => run.status === "pending")) throw new Error("the test run did not finish in three minutes");
    return runs().map((run) => toRun(run, check.endCall));
  } finally {
    // Best effort: a test left behind costs nothing and is named, so it can be deleted by hand.
    await call("DELETE", `/v1/convai/agent-testing/${encodeURIComponent(testId)}`, undefined, env).catch(() => undefined);
  }
}
