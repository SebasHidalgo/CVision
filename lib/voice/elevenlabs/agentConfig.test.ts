import { describe, expect, it } from "vitest";
import { INTERVIEWER_AGENT_PROMPT } from "@/lib/ai/prompts/interviewer.agent";
import { INTERVIEW_TIERS } from "@/lib/plans";
import {
  buildInterviewAgentDefinition,
  diffPaths,
  EXPECTED_TIER_DIFFERENCES,
  INTERVIEW_AGENT_DAILY_CALL_LIMITS,
  INTERVIEW_AGENT_NAMES,
} from "./agentConfig";

describe("the two interview agents", () => {
  const full = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1" });
  const trial = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1", tier: "TRIAL" });

  it("differ only in name, tags, hard duration, daily cap and the dashboard placeholders", () => {
    expect(diffPaths(full, trial)).toEqual([...EXPECTED_TIER_DIFFERENCES].sort());
  });

  it("give the trial five minutes, a smaller daily cap and its own name, on the same prompt, webhook and locks", () => {
    expect(trial.name).toBe(INTERVIEW_AGENT_NAMES.TRIAL);
    expect(trial.name).not.toBe(full.name);
    expect(trial.conversationConfig.conversation?.maxDurationSeconds).toBe(INTERVIEW_TIERS.TRIAL.seconds);
    expect(trial.conversationConfig.conversation?.maxDurationSeconds).toBe(300);
    expect(full.conversationConfig.conversation?.maxDurationSeconds).toBe(720);
    expect(trial.platformSettings.callLimits?.dailyLimit).toBe(INTERVIEW_AGENT_DAILY_CALL_LIMITS.TRIAL);
    expect(trial.platformSettings.callLimits?.dailyLimit).toBeLessThan(INTERVIEW_AGENT_DAILY_CALL_LIMITS.FULL);

    expect(trial.conversationConfig.agent?.prompt?.prompt).toBe(INTERVIEWER_AGENT_PROMPT);
    expect(trial.platformSettings.workspaceOverrides?.webhooks).toEqual(full.platformSettings.workspaceOverrides?.webhooks);
    expect(trial.platformSettings.auth).toEqual({ enableAuth: true, allowlist: [] });
    expect(trial.platformSettings.overrides?.conversationConfigOverride?.agent?.prompt?.prompt).toBe(false);
  });

  it("cannot be ended by a pause for thought: a nudge after 20 s, the call closed only after two minutes of silence", () => {
    for (const agent of [full, trial]) {
      expect(agent.conversationConfig.turn).toEqual({ turnTimeout: 20, silenceEndCallTimeout: 120 });
    }
  });

  it("name their one backup model, and tell end_call when it may be used", () => {
    for (const agent of [full, trial]) {
      const prompt = agent.conversationConfig.agent?.prompt;
      expect(prompt?.backupLlmConfig).toEqual({ preference: "override", order: ["gpt-4o"] });
      expect(prompt?.cascadeTimeoutSeconds).toBe(4);
      const endCall = prompt?.builtInTools?.endCall;
      expect(endCall?.description).toContain("Hangs up the call the moment the reply it is called with has been spoken");
      expect(endCall?.description).toContain("Never call it together with a question or a request");
      expect(endCall?.description).toContain("the goodbye must be in your reply");
    }
  });

  it("tell the dashboard's test call the trial's minutes", () => {
    const placeholders = (
      trial.conversationConfig.agent?.dynamicVariables as { dynamicVariablePlaceholders?: Record<string, string> } | undefined
    )?.dynamicVariablePlaceholders as Record<string, string>;
    expect(placeholders.interview_minutes).toBe("5");
    expect(placeholders.opening_line).toContain("We have about 5 minutes.");
    expect(INTERVIEWER_AGENT_PROMPT).not.toContain("max_minutes");
  });
});

describe("diffPaths", () => {
  it("names the leaves that differ, compares arrays whole, and treats a missing key as a difference", () => {
    expect(diffPaths({ a: 1, b: { c: [1, 2], d: "x" } }, { a: 1, b: { c: [1, 3], d: "x" }, e: null })).toEqual(["b.c", "e"]);
    expect(diffPaths("x", "x")).toEqual([]);
    expect(diffPaths("x", "y")).toEqual(["(root)"]);
  });
});
