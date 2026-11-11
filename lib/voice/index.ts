import "server-only";

import type { InterviewTierId } from "@/lib/plans";
import * as provider from "./elevenlabs/client";

/**
 * The voice provider, in the app's words: start a session, read a webhook
 * delivery, fetch or delete a conversation, read the balance. The adapter in
 * ./elevenlabs is the only code that knows the provider; swapping it is that
 * folder and the import above. The operator's side (agents, doctor, cost)
 * is in ./admin.
 */

export type { FetchedConversation, VoiceBalanceRead, VoiceWebhookEvent } from "./elevenlabs/client";
export { WebhookRejectedError } from "./elevenlabs/client";

export type VoiceSession = {
  /** Short-lived credential the browser opens the call with. */
  token: string;
  /** Known before the call starts: every later record matches by it. */
  conversationId: string;
  expiresAt: Date;
  /** What the interviewer is told, exactly as issued: the browser passes it on untouched. */
  variables: Record<string, string>;
};

/** A session on the agent of this tier. Throws VOICE_UNAVAILABLE or VOICE_MISCONFIGURED. */
export async function startVoiceSession({ tier, variables }: { tier: InterviewTierId; variables: Record<string, string> }): Promise<VoiceSession> {
  const session = await provider.issueConversationToken(tier);
  return { ...session, variables };
}

/** Verifies a post-call delivery over its exact bytes and reads it. */
export const verifyAndParseWebhook = provider.verifyAndParseWebhook;

/** The provider record of a conversation the server issued (the reconcile path). */
export const fetchConversation = provider.fetchConversation;

/** Removes a conversation and its transcript from the provider. */
export const deleteConversation = provider.deleteConversation;

/** The workspace balance, or the permission the key lacks to read it. */
export const readVoiceBalance = provider.readVoiceBalance;
