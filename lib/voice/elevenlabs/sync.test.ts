import { describe, expect, it, vi } from "vitest";
import { buildInterviewAgentDefinition, CLEARED_SETTINGS, END_INTERVIEW_TOOL_CONFIG, withClearedSettings } from "./agentConfig";
import { endToolProblem, findEndToolId, leftoverSettings, READBACK_BOOKKEEPING, SYNC_CHECK_SUFFIX } from "./sync";

const TOOL_ID = "tool_end_0001";

/** An agent as read back, with this prompt block. */
const agent = (prompt: Record<string, unknown> | null) => ({ conversationConfig: { agent: prompt === null ? null : { prompt } } });

describe("endToolProblem: only the room may hang up", () => {
  it("passes the agent the definition describes: the room's tool attached, no end_call", () => {
    const definition = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1", endToolId: TOOL_ID });
    expect(endToolProblem(definition, TOOL_ID)).toBeNull();
    // The platform reads built-in tools back with every slot named and empty.
    expect(endToolProblem(agent({ toolIds: [TOOL_ID, "tool_other"], builtInTools: { endCall: null, languageDetection: null } }), TOOL_ID)).toBeNull();
  });

  it("names an end_call left on first: with it the interviewer hangs up by itself", () => {
    const stale = agent({ toolIds: [TOOL_ID], builtInTools: { endCall: { type: "system", name: "end_call" } } });
    expect(endToolProblem(stale, TOOL_ID)).toBe("the platform's end_call tool is still on: the interviewer could hang up by itself");
  });

  it("names a missing tool: without it the interviewer cannot ask for the end", () => {
    const expected = `the end_interview tool (${TOOL_ID}) is not attached: the interviewer cannot ask the room to end the call`;
    expect(endToolProblem(agent({ toolIds: [], builtInTools: {} }), TOOL_ID)).toBe(expected);
    expect(endToolProblem(agent({ toolIds: ["tool_other"] }), TOOL_ID)).toBe(expected);
    expect(endToolProblem(agent({}), TOOL_ID)).toBe(expected);
    expect(endToolProblem(agent(null), TOOL_ID)).toBe(expected);
    // A definition built before the tool existed.
    expect(endToolProblem(buildInterviewAgentDefinition({ postCallWebhookId: "wh_1" }), TOOL_ID)).toBe(expected);
  });
});

describe("findEndToolId", () => {
  const client = (tools: { id: string; toolConfig: { type: string; name?: string } }[]) => {
    const list = vi.fn(async () => ({ tools, hasMore: false }));
    return { list, api: { conversationalAi: { tools: { list } } } as unknown as Parameters<typeof findEndToolId>[0] };
  };

  it("finds the client tool with the exact name, among others the search returns", async () => {
    const { api, list } = client([
      { id: "tool_prefix", toolConfig: { type: "client", name: "end_interview_draft" } },
      { id: "tool_hook", toolConfig: { type: "webhook", name: END_INTERVIEW_TOOL_CONFIG.name } },
      { id: TOOL_ID, toolConfig: { type: "client", name: END_INTERVIEW_TOOL_CONFIG.name } },
    ]);
    expect(await findEndToolId(api)).toBe(TOOL_ID);
    expect(list).toHaveBeenCalledWith({ search: "end_interview", types: "client", pageSize: 100 });
  });

  it("answers null before the first sync", async () => {
    expect(await findEndToolId(client([]).api)).toBeNull();
    expect(await findEndToolId(client([{ id: "tool_prefix", toolConfig: { type: "client", name: "end_interview_draft" } }]).api)).toBeNull();
  });
});

describe("leftoverSettings: what an update kept that the definition no longer sets", () => {
  const read = (over: Record<string, unknown> = {}) => ({
    agentId: "agent_1",
    name: "CVision Interviewer",
    versionId: "v1",
    metadata: { createdAtUnixSecs: 1, updatedAtUnixSecs: 2 },
    workflow: { edges: {}, nodes: {}, preventSubagentLoops: true },
    conversationConfig: { turn: { turnTimeout: 12 }, agent: { prompt: { builtInTools: {} } } },
    ...over,
  });

  it("finds nothing between an agent and a fresh one from the same definition, ids, names and timestamps aside", () => {
    const fresh = read({ agentId: "agent_fresh", name: `CVision Interviewer${SYNC_CHECK_SUFFIX}`, versionId: "v9", metadata: { createdAtUnixSecs: 9, updatedAtUnixSecs: 9 } });
    expect(leftoverSettings(read(), fresh)).toEqual([]);
  });

  it("names a setting the platform kept, a default that changed, and one the fresh agent has that the synced one lost", () => {
    const synced = read({ conversationConfig: { turn: { turnTimeout: 12 }, agent: { prompt: { builtInTools: { endCall: { name: "end_call" } } } } }, workflow: { edges: {}, nodes: {}, preventSubagentLoops: false } });
    expect(leftoverSettings(synced, read())).toEqual(["conversationConfig.agent.prompt.builtInTools.endCall", "workflow.preventSubagentLoops"]);
  });

  it("gives every bookkeeping entry a reason", () => {
    for (const entry of READBACK_BOOKKEEPING) expect(entry.reason.length).toBeGreaterThan(10);
  });
});

describe("CLEARED_SETTINGS: removed keys go out as null", () => {
  it("writes each as null in both definitions, and only those", () => {
    for (const tier of ["FULL", "TRIAL"] as const) {
      const definition = buildInterviewAgentDefinition({ postCallWebhookId: null, endToolId: "tool_1", tier });
      for (const { path, reason } of CLEARED_SETTINGS) {
        expect(path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], definition)).toBeNull();
        expect(reason).not.toBe("");
      }
    }
    const plain = { name: "a", tags: [], conversationConfig: {}, platformSettings: {}, workflow: {} };
    expect(withClearedSettings(plain).conversationConfig).toEqual({ agent: { prompt: { builtInTools: { endCall: null } } } });
    // The input is not changed.
    expect(plain.conversationConfig).toEqual({});
  });
});