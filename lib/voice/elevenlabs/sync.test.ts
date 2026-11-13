import { describe, expect, it, vi } from "vitest";
import { buildInterviewAgentDefinition, END_INTERVIEW_TOOL_CONFIG } from "./agentConfig";
import { endToolProblem, findEndToolId } from "./sync";

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
