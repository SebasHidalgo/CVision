/**
 * The operator side of the voice provider, for scripts: the agents as code,
 * the read-only doctor, what conversations cost, the voice samples and the
 * text-only check of the interviewer's next turn. No server-only import, so tsx can load it.
 */
export { runVoiceDoctor, type VoiceDoctorCheck, type VoiceDoctorOptions } from "./elevenlabs/doctor";
export { endToolIdFromWorkspace, syncAgents, type SyncAgentsOptions } from "./elevenlabs/sync";
import { INTERVIEW_AGENT_TTS_MODEL_MULTILINGUAL, interviewAgentIdsFromEnv, SPANISH_VOICE_SAMPLE_TEXT } from "./elevenlabs/agentConfig";
import { synthesizeSample } from "./elevenlabs/cost";

export { listConversationIds, readConversationCost, readConversationTurns, readPlanPrice, summarizeCosts, type ConversationCost, type CostSummary, type PlanPrice, type RecordedTurnLine } from "./elevenlabs/cost";
export { SPANISH_VOICE_CANDIDATES, SPANISH_VOICE_SAMPLE_TEXT } from "./elevenlabs/agentConfig";
export { agentConfigOverride, checkNextTurn, type NextTurnCheck, type NextTurnRun } from "./elevenlabs/simulate";

/** The agent ids the environment holds: the conversations voice:cost reads are theirs. */
export const INTERVIEW_AGENT_IDS_FROM_ENV = interviewAgentIdsFromEnv;

/** The Spanish greeting in one voice, on the model the Spanish preset uses. */
export const synthesizeVoiceSample = (voiceId: string) =>
  synthesizeSample({ voiceId, text: SPANISH_VOICE_SAMPLE_TEXT, modelId: INTERVIEW_AGENT_TTS_MODEL_MULTILINGUAL, languageCode: "es" });
