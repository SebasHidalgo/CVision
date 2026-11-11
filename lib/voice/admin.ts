/**
 * The operator side of the voice provider, for scripts: the agents as code,
 * the read-only doctor and what a conversation cost. No server-only import, so tsx can load it.
 */
export { runVoiceDoctor, type VoiceDoctorCheck, type VoiceDoctorOptions } from "./elevenlabs/doctor";
export { syncAgents, type SyncAgentsOptions } from "./elevenlabs/sync";
export { listConversationIds, readConversationCost, type ConversationCost } from "./elevenlabs/cost";
