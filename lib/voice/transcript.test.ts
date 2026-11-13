import { describe, expect, it } from "vitest";
import { STORED_TURN_FIELDS, trimStoredTurns } from "./transcript";

describe("trimStoredTurns: what the app keeps of a call's turns", () => {
  it("keeps who spoke, what and when, and nothing else the platform sent", () => {
    const platformTurn = {
      role: "agent",
      message: "Tell me about the last service you shipped.",
      time_in_call_secs: 12,
      interrupted: false,
      llm_usage: { model_usage: { any: { input: { tokens: 900 } } } },
      conversation_turn_metrics: { metrics: { convai_llm_service_ttfb: { elapsed_time: 0.4 } } },
      agent_metadata: { agent_id: "agent_x", workflow_node_id: null },
      rag_retrieval_info: null,
      source_medium: "audio",
    };

    const [kept] = trimStoredTurns([platformTurn]);

    expect(kept).toEqual({ role: "agent", message: "Tell me about the last service you shipped.", time_in_call_secs: 12 });
    expect(Object.keys(kept).sort()).toEqual([...STORED_TURN_FIELDS].sort());
  });

  it("drops turns without words: tool calls, their results, and anything that is not a turn", () => {
    const turns = [
      { role: "agent", message: null, tool_calls: [{ tool_name: "end_interview", params_as_json: "{}" }], time_in_call_secs: 300 },
      { role: "agent", message: "", tool_results: [{ tool_name: "end_interview", result_value: "ALLOWED" }] },
      { role: "user", message: "   " },
      null,
      "noise",
      { role: "user", message: "I led the migration.", time_in_call_secs: 20 },
    ];

    expect(trimStoredTurns(turns)).toEqual([{ role: "user", message: "I led the migration.", time_in_call_secs: 20 }]);
  });

  it("keeps the marker between two calls of a resumed interview, and a turn with no time", () => {
    expect(trimStoredTurns([{ role: "system", message: "[call resumed]" }])).toEqual([{ role: "system", message: "[call resumed]" }]);
  });

  it("changes nothing in turns already trimmed", () => {
    const trimmed = [
      { role: "agent", message: "Welcome.", time_in_call_secs: 0 },
      { role: "user", message: "Thanks.", time_in_call_secs: 4 },
    ];
    expect(trimStoredTurns(trimmed)).toEqual(trimmed);
  });
});
