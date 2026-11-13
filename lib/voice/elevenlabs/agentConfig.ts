import { BRAND } from "@/lib/brand";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import {
  INTERVIEWER_AGENT_PROMPT,
  FIRST_CALL_CONTEXT,
  INTERVIEWER_FIRST_MESSAGE,
  type InterviewerVariables,
} from "@/lib/ai/prompts/interviewer.agent";
import { INTERVIEW_TIERS, type InterviewTierId } from "@/lib/plans";

/**
 * The interview agents, as code. `scripts/voice/sync-agent.ts` pushes
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

/** How long the agent waits for an answer before one short nudge; the default of 7 s cuts into thinking. */
export const INTERVIEW_TURN_TIMEOUT_SECONDS = 20;
/** Ends an abandoned call. Counted from the candidate's last words, so a long question plus thinking must fit. */
export const INTERVIEW_SILENCE_END_CALL_SECONDS = 120;

/** One named backup model, tested on the ending rules; the platform's default list is not ours to know. */
export const INTERVIEW_AGENT_BACKUP_LLMS: ElevenLabs.Llm[] = ["gpt-4o"];
/** Seconds the primary model gets before the backup answers the turn. */
export const INTERVIEW_AGENT_CASCADE_TIMEOUT_SECONDS = 4;

/** When end_call may be used: on a backup model the tool's own description weighs more than the prompt. */
export const END_CALL_DESCRIPTION =
  "Hangs up the call the moment the reply it is called with has been spoken: the candidate cannot answer anything said in that reply. Call it only together with the spoken goodbye (thanks, and that the feedback will appear on the candidate's screen), and only after a [time] line said about one minute remains or after the candidate answered yes to your question whether to end the interview now. Never call it together with a question or a request, the confirmation question and \"take your time\" included, and never while a question of yours has no answer. This tool's own message is not spoken: the goodbye must be in your reply.";

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

/** The agent ids the environment holds, full first. */
export function interviewAgentIdsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  return (["FULL", "TRIAL"] as const).map((tier) => env[INTERVIEW_AGENT_ID_ENV[tier]]?.trim() ?? "").filter(Boolean);
}

/** Per environment: production raises these as usage grows; unset keeps the development caps. */
export const INTERVIEW_AGENT_DAILY_CALL_LIMIT_ENV: Record<InterviewTierId, string> = {
  FULL: "ELEVENLABS_DAILY_CALL_LIMIT",
  TRIAL: "ELEVENLABS_TRIAL_DAILY_CALL_LIMIT",
};

/** The daily cap of a tier: its env var when it holds a positive integer, the default otherwise. */
export function readDailyCallLimit(tier: InterviewTierId, env: Record<string, string | undefined> = process.env): number {
  const raw = env[INTERVIEW_AGENT_DAILY_CALL_LIMIT_ENV[tier]]?.trim();
  const value = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
  return value > 0 ? value : INTERVIEW_AGENT_DAILY_CALL_LIMITS[tier];
}

/**
 * Concurrency. Bursting lets calls past the plan limit (up to three times it,
 * at twice the rate) instead of refusing them; past that, the queue holds a
 * caller this long before the platform refuses. Queue time is not billed.
 */
export const INTERVIEW_BURSTING_ENABLED = true;
export const INTERVIEW_QUEUE_WAIT_SECONDS = 60;

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

/** Said by the platform when the hard cap cuts the call; each language preset carries its own. */
const MAX_DURATION_MESSAGE =
  "We're at time, so we'll stop here. Thank you for practicing. Your feedback will appear on your screen in a moment.";
const MAX_DURATION_MESSAGES: Record<(typeof INTERVIEW_AGENT_EXTRA_LANGUAGES)[number], string> = {
  es: "Se nos acabó el tiempo, así que lo dejamos aquí. Gracias por practicar. Tu feedback aparecerá en tu pantalla en un momento.",
};

/** The voice of each extra language. Spanish is Norah, a library voice the owner chose; voice:doctor checks it still exists. */
export const INTERVIEW_AGENT_PRESET_VOICE_IDS: Record<(typeof INTERVIEW_AGENT_EXTRA_LANGUAGES)[number], string | null> = {
  es: "kcQkGnn0HAT2JRDQ4Ljp",
};

/** Every voice the agents speak with, and the model each is used on: what voice:doctor verifies. */
export function interviewAgentVoices(): { language: string; voiceId: string; modelId: string }[] {
  return [
    { language: INTERVIEW_AGENT_DEFAULT_LANGUAGE, voiceId: INTERVIEW_AGENT_VOICE_ID, modelId: INTERVIEW_AGENT_TTS_MODEL },
    ...INTERVIEW_AGENT_EXTRA_LANGUAGES.flatMap((language) => {
      const voiceId = INTERVIEW_AGENT_PRESET_VOICE_IDS[language];
      return voiceId && voiceId !== INTERVIEW_AGENT_VOICE_ID ? [{ language, voiceId, modelId: INTERVIEW_AGENT_TTS_MODEL_MULTILINGUAL }] : [];
    }),
  ];
}

/**
 * The voices the owner chose the Spanish one from (npm run voice:samples):
 * the English voice, and two native Latin American voices of the ElevenLabs
 * library tagged conversational. A library voice is added to the workspace
 * before an agent can use it, and may carry a surcharge voice:cost shows.
 */
export const SPANISH_VOICE_CANDIDATES = [
  { slug: "actual-sarah", name: "Sarah, the English voice (American English, on the multilingual model)", id: INTERVIEW_AGENT_VOICE_ID },
  { slug: "norah-latinoamericana", name: "Norah, Latin American Spanish, warm and clear", id: "kcQkGnn0HAT2JRDQ4Ljp" },
  { slug: "ana-maria-mexicana", name: "Ana María, Mexican Spanish, calm and natural", id: "m7yTemJqdIqrcNleANfX" },
] as const;

/** The same greeting the interviewer opens a Spanish call with, for an invented candidate. */
export const SPANISH_VOICE_SAMPLE_TEXT =
  "Hola Ana, gracias por conectarte. Voy a entrevistarte para el puesto de Analista de Datos en Northwind. Tenemos unos doce minutos. Para empezar, cuéntame brevemente sobre tu trayectoria.";

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
    call_context: FIRST_CALL_CONTEXT,
    opening_line: `Hi Alex, thanks for joining. I'll be interviewing you for the Frontend Engineer role at Northwind. We have about ${minutes} minutes. To start, tell me briefly about your background.`,
    job_description: "Build and ship the checkout flow in React and TypeScript.",
    analysis_summary: "The resume meets the required qualifications and shows one preferred one.",
    requirements_met: '- [required, met] React and TypeScript — resume says: "Led the checkout rewrite in React and TypeScript"',
    requirements_gaps: "- [preferred, missing] Experience with payment providers — note: nothing in the resume mentions payments.",
    requirements_not_evident: "- [required, not_evident] Legally authorised to work in the EU",
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
  env = process.env,
}: {
  postCallWebhookId: string | null;
  tier?: InterviewTierId;
  /** Where the per-environment daily cap is read from. */
  env?: Record<string, string | undefined>;
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
            endCall: { type: "system", name: "end_call", description: END_CALL_DESCRIPTION, params: { systemToolType: "end_call" } },
          },
          // Explicit: a backup model answers a turn the primary fails (seen live), so it is named and tested.
          backupLlmConfig: { preference: "override", order: INTERVIEW_AGENT_BACKUP_LLMS },
          cascadeTimeoutSeconds: INTERVIEW_AGENT_CASCADE_TIMEOUT_SECONDS,
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
      // One preset per non-default language: multilingual model, its own cutoff
      // line and, once chosen, its own voice. The first message is a variable
      // already in the session's language, so no translation is attached.
      languagePresets: Object.fromEntries(
        INTERVIEW_AGENT_EXTRA_LANGUAGES.map((language) => [
          language,
          {
            overrides: {
              agent: { language, maxConversationDurationMessage: MAX_DURATION_MESSAGES[language] },
              tts: {
                modelId: INTERVIEW_AGENT_TTS_MODEL_MULTILINGUAL,
                ...(INTERVIEW_AGENT_PRESET_VOICE_IDS[language] ? { voiceId: INTERVIEW_AGENT_PRESET_VOICE_IDS[language] } : {}),
              },
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
        dailyLimit: readDailyCallLimit(tier, env),
        burstingEnabled: INTERVIEW_BURSTING_ENABLED,
      },
      queueingConfig: { enabled: true, waitTimeoutSeconds: INTERVIEW_QUEUE_WAIT_SECONDS },
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
