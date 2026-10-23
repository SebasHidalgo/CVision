import { BRAND } from "@/lib/brand";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import {
  INTERVIEWER_AGENT_PROMPT,
  INTERVIEWER_FIRST_MESSAGE,
  type InterviewerVariables,
} from "@/lib/ai/prompts/interviewer.agent";
import { INTERVIEW_TIERS, type InterviewTierId } from "@/lib/plans";

/**
 * The interview agents, as code. `scripts/elevenlabs/sync-agent.ts` pushes
 * these definitions to ElevenLabs (create or update), so the dashboard is a
 * mirror and a reviewer diffs this file, not screenshots. Every value that
 * bounds cost or access is explicit here, including the ones that match the
 * platform default, so a flag flipped in the dashboard is overwritten on the
 * next sync.
 *
 * There are two agents, one per tier, built from the same definition: the
 * full twelve-minute interviewer and the five-minute trial a Free account
 * gets once. They differ only in name, hard duration, daily call cap and the
 * dashboard placeholders; prompt, voice, webhook and locks are shared, and
 * `agentConfig.test.ts` holds that list.
 */

// The limits the browser also shows live in lib/interviewLimits.ts (no
// imports there); re-exported so server code keeps one import for the
// agent's numbers.
export { MAX_INTERVIEW_DURATION_SECONDS, MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";

/** The env var that holds each agent's id, read by the client and the sync script. */
export const INTERVIEW_AGENT_ID_ENV: Record<InterviewTierId, string> = {
  FULL: "ELEVENLABS_AGENT_ID",
  TRIAL: "ELEVENLABS_TRIAL_AGENT_ID",
};

/**
 * Silence handling. `turnTimeout` is how long the agent waits for an answer
 * before re-engaging; the platform default of 7 s interrupts a candidate who
 * is thinking. `silenceEndCallTimeout` ends the call when the candidate has
 * said nothing for this long: a closed laptop or a muted mic stops costing
 * money after a minute instead of twelve.
 */
export const INTERVIEW_TURN_TIMEOUT_SECONDS = 15;
export const INTERVIEW_SILENCE_END_CALL_SECONDS = 60;

/**
 * Conversations per day per agent, across all users: an abuse brake on top
 * of the per-user quotas, which are the product limits. At the caps, worst
 * case is 100 x 12 min x $0.08 = $96 of platform minutes a day on the full
 * agent and 25 x 5 min x $0.08 = $10 on the trial, which is the one a fresh
 * account can reach.
 */
export const INTERVIEW_AGENT_DAILY_CALL_LIMITS: Record<InterviewTierId, number> = {
  FULL: 100,
  TRIAL: 25,
};

export const INTERVIEW_AGENT_NAMES: Record<InterviewTierId, string> = {
  FULL: `${BRAND.name} Interviewer`,
  TRIAL: `${BRAND.name} Interviewer (5-minute trial)`,
};
export const INTERVIEW_WEBHOOK_NAME = `${BRAND.name} post-call transcript`;

/**
 * The model behind the agent. Chosen for instruction following at
 * conversational latency: the prompt asks it to probe a hidden list without
 * naming it, which the Lite tier the analysis uses is weaker at. Billed by
 * ElevenLabs at the provider's token price on top of the per-minute rate;
 * see the M3-A report for the estimate.
 */
export const INTERVIEW_AGENT_LLM: ElevenLabs.Llm = "gemini-3.5-flash";
export const INTERVIEW_AGENT_LLM_TEMPERATURE = 0.3;

/** Sarah, a premade ElevenLabs voice: the one the interviewer has always had. */
export const INTERVIEW_AGENT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
/**
 * TTS models. The platform ties the default model to the agent's default
 * language: an English agent must use an English-only model (the first real
 * sync was refused with "English Agents must use turbo or flash v2"), and
 * every other language needs the multilingual one, declared per language in
 * `languagePresets` below. The Spanish preset is what a session's language
 * override selects.
 */
export const INTERVIEW_AGENT_TTS_MODEL: ElevenLabs.TtsConversationalModel = "eleven_flash_v2";
export const INTERVIEW_AGENT_TTS_MODEL_MULTILINGUAL: ElevenLabs.TtsConversationalModel = "eleven_flash_v2_5";
export const INTERVIEW_AGENT_ASR_PROVIDER: ElevenLabs.AsrProvider = "scribe_realtime";

/** Default language; a session may override it to Spanish (see overrides below). */
export const INTERVIEW_AGENT_DEFAULT_LANGUAGE = "en";
/** The other language the agent is configured for, as a preset the override can select. */
export const INTERVIEW_AGENT_EXTRA_LANGUAGES = ["es"] as const;

/** Said by the platform when the hard cap cuts the call. Plain field, English only. */
const MAX_DURATION_MESSAGE =
  "We're at time, so we'll stop here. Thank you for your answers. Your feedback will be ready shortly.";

/** What the dashboard's test call uses when nothing passes variables. */
function placeholders(tier: InterviewTierId): InterviewerVariables {
  const minutes = String(INTERVIEW_TIERS[tier].seconds / 60);
  return {
    interview_id: "test",
    candidate_name: "Alex",
    role: "Frontend Engineer",
    company: "Northwind",
    language_name: "English",
    interview_minutes: minutes,
    gaps_to_cover: "1",
    opening_line: `Hi Alex, thanks for joining. I'll be interviewing you for the Frontend Engineer role at Northwind. We have about ${minutes} minutes. To start, tell me briefly about your background.`,
    job_description: "Build and ship the checkout flow in React and TypeScript.",
    analysis_summary: "The resume meets the required qualifications and shows one preferred one.",
    requirements_met: '- [required, met] React and TypeScript — resume says: "Led the checkout rewrite in React and TypeScript"',
    requirements_gaps: "- [preferred, missing] Experience with payment providers — note: nothing in the resume mentions payments.",
  };
}

export type InterviewAgentDefinition = {
  name: string;
  tags: string[];
  conversationConfig: ElevenLabs.ConversationalConfig;
  platformSettings: ElevenLabs.AgentPlatformSettingsRequestModel;
};

/**
 * One agent in full. `postCallWebhookId` is the workspace webhook that
 * receives transcripts (the same one for both tiers); null leaves the agent
 * without one (the sync script warns).
 */
export function buildInterviewAgentDefinition({
  postCallWebhookId,
  tier = "FULL",
}: {
  postCallWebhookId: string | null;
  tier?: InterviewTierId;
}): InterviewAgentDefinition {
  return {
    name: INTERVIEW_AGENT_NAMES[tier],
    tags: tier === "TRIAL" ? ["cvision", "trial"] : ["cvision"],
    conversationConfig: {
      agent: {
        firstMessage: INTERVIEWER_FIRST_MESSAGE,
        language: INTERVIEW_AGENT_DEFAULT_LANGUAGE,
        maxConversationDurationMessage: MAX_DURATION_MESSAGE,
        dynamicVariables: { dynamicVariablePlaceholders: placeholders(tier) },
        prompt: {
          prompt: INTERVIEWER_AGENT_PROMPT,
          llm: INTERVIEW_AGENT_LLM,
          temperature: INTERVIEW_AGENT_LLM_TEMPERATURE,
          // No knowledge base and no custom tools: the context is all in the
          // prompt. The one system tool lets the agent end the call after its
          // closing line instead of waiting for the candidate or for silence.
          toolIds: [],
          knowledgeBase: [],
          builtInTools: {
            endCall: { type: "system", name: "end_call", params: { systemToolType: "end_call" } },
          },
        },
      },
      asr: {
        provider: INTERVIEW_AGENT_ASR_PROVIDER,
        quality: "high",
      },
      tts: {
        modelId: INTERVIEW_AGENT_TTS_MODEL,
        voiceId: INTERVIEW_AGENT_VOICE_ID,
      },
      // One preset per non-default language: same voice, multilingual model.
      // The first message is a variable already in the session's language,
      // so no translation is attached.
      languagePresets: Object.fromEntries(
        INTERVIEW_AGENT_EXTRA_LANGUAGES.map((language) => [
          language,
          {
            overrides: {
              agent: { language },
              tts: { modelId: INTERVIEW_AGENT_TTS_MODEL_MULTILINGUAL },
            },
          },
        ]),
      ),
      turn: {
        turnTimeout: INTERVIEW_TURN_TIMEOUT_SECONDS,
        silenceEndCallTimeout: INTERVIEW_SILENCE_END_CALL_SECONDS,
      },
      conversation: {
        // The tier's hard limit: the platform cuts the call here, whatever
        // the browser or the prompt say.
        maxDurationSeconds: INTERVIEW_TIERS[tier].seconds,
        textOnly: false,
      },
    },
    platformSettings: {
      // Private: a conversation needs a token the server fetched with the key.
      auth: { enableAuth: true, allowlist: [] },
      // Only the language may be overridden from the browser, because ASR and
      // TTS language is a config field, not a prompt variable. Everything
      // else stays locked: a client-supplied prompt would replace this file.
      overrides: {
        conversationConfigOverride: {
          agent: {
            language: true,
            firstMessage: false,
            maxConversationDurationMessage: false,
            prompt: { prompt: false, llm: false, toolIds: false, knowledgeBase: false },
          },
          tts: { voiceId: false, stability: false, speed: false, similarityBoost: false },
          conversation: { textOnly: false },
          asr: { keywords: false },
        },
        customLlmExtraBody: false,
        enableConversationInitiationClientDataFromWebhook: false,
      },
      workspaceOverrides: {
        webhooks: postCallWebhookId
          ? { postCallWebhookId, events: ["transcript"], transcriptFormat: "json" }
          : { events: [] },
      },
      callLimits: {
        dailyLimit: INTERVIEW_AGENT_DAILY_CALL_LIMITS[tier],
        burstingEnabled: false,
      },
      // The transcript reaches us by webhook; the platform's copy is only for
      // debugging, so it does not keep audio and expires after a month.
      privacy: {
        recordVoice: false,
        retentionDays: 30,
      },
    },
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The dotted paths at which two JSON-shaped values differ; arrays and
 * scalars compare whole. What the sync script prints for the two agents it
 * read back, and what the test pins for the two definitions.
 */
export function diffPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((key) => diffPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix || "(root)"];
}

/** Where the two tiers' definitions are meant to differ, and nowhere else. */
export const EXPECTED_TIER_DIFFERENCES = [
  "name",
  "tags",
  "conversationConfig.conversation.maxDurationSeconds",
  "platformSettings.callLimits.dailyLimit",
  "conversationConfig.agent.dynamicVariables.dynamicVariablePlaceholders.interview_minutes",
  "conversationConfig.agent.dynamicVariables.dynamicVariablePlaceholders.opening_line",
] as const;
