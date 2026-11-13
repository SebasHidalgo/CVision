import { describe, expect, it } from "vitest";
import { INTERVIEW_TIERS } from "@/lib/plans";
import { buildInterviewAgentDefinition } from "@/lib/voice/elevenlabs/agentConfig";
import { INTERVIEW_ABANDON_MS, INTERVIEW_GRACE_SECONDS, INTERVIEW_LAST_MINUTE_SECONDS, MAX_CALL_SECONDS, MAX_INTERVIEW_DURATION_SECONDS, MAX_INTERVIEW_STARTS } from "./interviewLimits";

describe("interview limits", () => {
  it("are the full interview's paid length and the start cap; quotas live in lib/plans.ts", () => {
    expect(MAX_INTERVIEW_DURATION_SECONDS).toBe(12 * 60);
    expect(MAX_INTERVIEW_STARTS).toBe(3);
  });

  it("give every call a grace of a minute past its paid length, for the last answer and the goodbye", () => {
    expect(INTERVIEW_GRACE_SECONDS).toBe(60);
    expect(MAX_CALL_SECONDS).toBe(13 * 60);
    // The platform's limit is the paid length plus the grace, for both tiers.
    for (const tier of ["FULL", "TRIAL"] as const) {
      const limit = buildInterviewAgentDefinition({ postCallWebhookId: null, tier }).conversationConfig.conversation?.maxDurationSeconds;
      expect(limit).toBe(INTERVIEW_TIERS[tier].seconds + INTERVIEW_GRACE_SECONDS);
    }
    expect(INTERVIEW_TIERS.FULL.seconds).toBe(MAX_INTERVIEW_DURATION_SECONDS);
  });

  it("keep the last minute for short questions, and expire an abandoned interview far past any call", () => {
    expect(INTERVIEW_LAST_MINUTE_SECONDS).toBe(60);
    expect(INTERVIEW_ABANDON_MS).toBeGreaterThan(MAX_CALL_SECONDS * 1000 * 5);
  });
});
