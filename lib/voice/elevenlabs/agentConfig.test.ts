import { describe, expect, it } from "vitest";
import { INTERVIEWER_AGENT_PROMPT } from "@/lib/ai/prompts/interviewer.agent";
import { INTERVIEW_GRACE_SECONDS, MAX_CALL_SECONDS } from "@/lib/interviewLimits";
import { INTERVIEW_TIERS } from "@/lib/plans";
import { END_INTERVIEW_TOOL, END_TOOL_REASONS } from "@/lib/voice/callEnd";
import {
  buildInterviewAgentDefinition,
  diffPaths,
  END_INTERVIEW_TOOL_CONFIG,
  EXPECTED_TIER_DIFFERENCES,
  INTERVIEW_AGENT_DAILY_CALL_LIMITS,
  INTERVIEW_AGENT_NAMES,
} from "./agentConfig";

describe("the two interview agents", () => {
  const full = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1", endToolId: "tool_end_1" });
  const trial = buildInterviewAgentDefinition({ postCallWebhookId: "wh_1", endToolId: "tool_end_1", tier: "TRIAL" });

  it("differ only in name, tags, hard duration, daily cap and the dashboard placeholders", () => {
    expect(diffPaths(full, trial)).toEqual([...EXPECTED_TIER_DIFFERENCES].sort());
  });

  it("give the trial five minutes, a smaller daily cap and its own name, on the same prompt, webhook and locks", () => {
    expect(trial.name).toBe(INTERVIEW_AGENT_NAMES.TRIAL);
    expect(trial.name).not.toBe(full.name);
    // The platform's limit is the paid length plus the grace, for both tiers.
    expect(INTERVIEW_GRACE_SECONDS).toBe(60);
    expect(INTERVIEW_TIERS.TRIAL.seconds).toBe(300);
    expect(INTERVIEW_TIERS.FULL.seconds).toBe(720);
    expect(trial.conversationConfig.conversation?.maxDurationSeconds).toBe(INTERVIEW_TIERS.TRIAL.seconds + INTERVIEW_GRACE_SECONDS);
    expect(trial.conversationConfig.conversation?.maxDurationSeconds).toBe(360);
    expect(full.conversationConfig.conversation?.maxDurationSeconds).toBe(780);
    expect(full.conversationConfig.conversation?.maxDurationSeconds).toBe(MAX_CALL_SECONDS);
    expect(trial.platformSettings.callLimits?.dailyLimit).toBe(INTERVIEW_AGENT_DAILY_CALL_LIMITS.TRIAL);
    expect(trial.platformSettings.callLimits?.dailyLimit).toBeLessThan(INTERVIEW_AGENT_DAILY_CALL_LIMITS.FULL);

    expect(trial.conversationConfig.agent?.prompt?.prompt).toBe(INTERVIEWER_AGENT_PROMPT);
    expect(trial.platformSettings.workspaceOverrides?.webhooks).toEqual(full.platformSettings.workspaceOverrides?.webhooks);
    expect(trial.platformSettings.auth).toEqual({ enableAuth: true, allowlist: [] });
    expect(trial.platformSettings.overrides?.conversationConfigOverride?.agent?.prompt?.prompt).toBe(false);
  });

  it("cannot be ended by a pause for thought: a nudge after 12 s, the call closed only after two minutes of silence", () => {
    for (const agent of [full, trial]) {
      expect(agent.conversationConfig.turn).toEqual({ turnTimeout: 12, silenceEndCallTimeout: 120 });
    }
  });

  it("name their one backup model", () => {
    for (const agent of [full, trial]) {
      const prompt = agent.conversationConfig.agent?.prompt;
      expect(prompt?.backupLlmConfig).toEqual({ preference: "override", order: ["gpt-4o"] });
      expect(prompt?.cascadeTimeoutSeconds).toBe(4);
    }
  });

  it("cannot hang up by themselves: end_call switched off by name, and one tool, which the room answers", () => {
    for (const agent of [full, trial]) {
      const prompt = agent.conversationConfig.agent?.prompt;
      // An update merges: leaving end_call out would keep it on the platform (seen on the first M10-F sync), so it is sent as null.
      expect(prompt?.builtInTools).toEqual({ endCall: null });
      expect(prompt?.toolIds).toEqual(["tool_end_1"]);
      // Inline tools are the deprecated way to attach one: none.
      expect((prompt as { tools?: unknown } | undefined)?.tools).toBeUndefined();
      expect(JSON.stringify(agent)).not.toContain("end_call");
    }
    // Without the workspace id (a dry run, a first sync that could not create it) the agent has no tool at all.
    expect(buildInterviewAgentDefinition({ postCallWebhookId: "wh_1" }).conversationConfig.agent?.prompt?.toolIds).toEqual([]);
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

describe("the end_interview tool", () => {
  it("is a client tool the interviewer waits on, with one parameter of two values", () => {
    expect(END_INTERVIEW_TOOL_CONFIG.type).toBe("client");
    expect(END_INTERVIEW_TOOL_CONFIG.name).toBe(END_INTERVIEW_TOOL);
    expect(END_INTERVIEW_TOOL_CONFIG.name).toBe("end_interview");
    // The room's answer goes to the model: that is how a refusal reaches it.
    expect(END_INTERVIEW_TOOL_CONFIG.expectsResponse).toBe(true);
    // "post_tool_speech" looped in the platform's test mode (two runs of about 1,800 credits): immediate, and the room waits for the goodbye itself.
    expect(END_INTERVIEW_TOOL_CONFIG.executionMode).toBe("immediate");
    // The room holds an allowed call open while the goodbye is spoken (30 s at most): the tool must not time out first.
    expect(END_INTERVIEW_TOOL_CONFIG.responseTimeoutSecs).toBeGreaterThan(30);
    expect(END_INTERVIEW_TOOL_CONFIG.responseTimeoutSecs).toBeLessThanOrEqual(120);
    expect(END_INTERVIEW_TOOL_CONFIG.parameters).toMatchObject({ type: "object", required: ["reason"], properties: { reason: { type: "string", enum: [...END_TOOL_REASONS] } } });
    expect(END_TOOL_REASONS).toEqual(["time_up", "candidate_confirmed"]);
  });

  it("tells the model when to call it, that it goes with the goodbye and nothing else, and what a refusal means", () => {
    const description = END_INTERVIEW_TOOL_CONFIG.description;
    expect(description).toContain("only the room can hang up");
    expect(description).toContain("The room acts once the reply this is called with has been spoken");
    expect(description).toContain("Call it only together with the spoken goodbye");
    expect(description).toContain("only after a [time] line said the interview time is up (reason time_up)");
    expect(description).toContain("after the candidate answered yes to your question whether to end the interview now (reason candidate_confirmed)");
    expect(description).toContain("Never call it together with a question or a request");
    expect(description).toContain("never while a question of yours has no answer");
    expect(description).toContain("If the result starts with REFUSED, the call continues");
  });
});

describe("diffPaths", () => {
  it("names the leaves that differ, compares arrays whole, and treats a missing key as a difference", () => {
    expect(diffPaths({ a: 1, b: { c: [1, 2], d: "x" } }, { a: 1, b: { c: [1, 3], d: "x" }, e: null })).toEqual(["b.c", "e"]);
    expect(diffPaths("x", "x")).toEqual([]);
    expect(diffPaths("x", "y")).toEqual(["(root)"]);
  });
});
