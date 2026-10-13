import "server-only";

import {
  ElevenLabsClient,
  ElevenLabsError,
  ElevenLabsTimeoutError,
} from "@elevenlabs/elevenlabs-js";
import {
  CONVERSATION_ENDED_STATUSES,
  fromConversationApi,
  type PostCallTranscription,
} from "@/lib/elevenlabs/postCall";
import {
  type AppError,
  VoiceMisconfiguredError,
  VoiceUnavailableError,
} from "@/lib/error/errors";

/**
 * The only module that talks to ElevenLabs at runtime. Three calls: issue a
 * conversation token (session endpoint), verify a webhook signature
 * (post-call route), and fetch a conversation by id (the reconcile fallback
 * for a webhook that never arrived). The agent itself is managed by
 * scripts/elevenlabs.
 */

/** A single fast call; the route's budget is on top of this. */
const TOKEN_TIMEOUT_SECONDS = 10;

/**
 * Signed URLs are documented as valid for 15 minutes. The WebRTC token
 * reference states no lifetime, so the token's own `exp` claim is used when
 * it carries one and this is the fallback. The browser treats it as a hint.
 */
export const CONVERSATION_TOKEN_TTL_MS = 15 * 60 * 1000;

export type ConversationSession = {
  token: string;
  /** Known before the call starts: the post-call webhook matches by it. */
  conversationId: string;
  expiresAt: Date;
};

// Read per call, not at import: a missing key must fail the request, not the
// boot, and tests set these per case.
function readConfig() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY?.trim() || undefined,
    agentId: process.env.ELEVENLABS_AGENT_ID?.trim() || undefined,
    webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET?.trim() || undefined,
  };
}

/** A WebRTC conversation token for the configured agent, server-side only. */
export async function issueConversationToken(): Promise<ConversationSession> {
  const { apiKey, agentId } = readConfig();
  if (!apiKey) throw new VoiceMisconfiguredError("ELEVENLABS_API_KEY is not set");
  if (!agentId) throw new VoiceMisconfiguredError("ELEVENLABS_AGENT_ID is not set");

  const client = new ElevenLabsClient({
    apiKey,
    timeoutInSeconds: TOKEN_TIMEOUT_SECONDS,
    // One attempt: the user can retry, and a retry here would double a
    // request that may already have been counted.
    maxRetries: 0,
  });

  let response: { token?: string; conversationId?: string };
  try {
    response = await client.conversationalAi.conversations.getWebrtcToken({ agentId });
  } catch (error) {
    throw toVoiceError(error);
  }

  const { token, conversationId } = response;
  if (!token || !conversationId) {
    throw new VoiceUnavailableError("ElevenLabs returned an incomplete token response");
  }

  return {
    token,
    conversationId,
    expiresAt: tokenExpiry(token) ?? new Date(Date.now() + CONVERSATION_TOKEN_TTL_MS),
  };
}

export type FetchedConversation =
  /** The platform still has the call open, or is still processing it. */
  | { kind: "in-progress"; platformStatus: string }
  /** Over, in the shape the webhook would have delivered. */
  | { kind: "ended"; data: PostCallTranscription }
  /** The platform has no such conversation. */
  | { kind: "not-found" };

/**
 * The platform's own record of a conversation the server issued. Only the
 * reconcile path calls this, for an interview whose webhook never came, so
 * the id is always one the session endpoint minted.
 */
export async function fetchConversation(conversationId: string): Promise<FetchedConversation> {
  const { apiKey } = readConfig();
  if (!apiKey) throw new VoiceMisconfiguredError("ELEVENLABS_API_KEY is not set");

  const client = new ElevenLabsClient({
    apiKey,
    timeoutInSeconds: TOKEN_TIMEOUT_SECONDS,
    maxRetries: 0,
  });

  try {
    const record = await client.conversationalAi.conversations.get(conversationId);
    if (!CONVERSATION_ENDED_STATUSES.has(record.status)) {
      return { kind: "in-progress", platformStatus: record.status };
    }
    return { kind: "ended", data: fromConversationApi(record) };
  } catch (error) {
    if (error instanceof ElevenLabsError && error.statusCode === 404) return { kind: "not-found" };
    throw toVoiceError(error);
  }
}

/** Thrown when a webhook delivery fails verification. Never reaches a user. */
export class WebhookRejectedError extends Error {
  constructor(message = "Webhook signature rejected") {
    super(message);
    this.name = "WebhookRejectedError";
  }
}

/**
 * Verifies `ElevenLabs-Signature` over the exact request bytes and returns
 * the parsed event. The SDK checks the HMAC and rejects timestamps older than
 * 30 minutes. A missing secret is an operator error, not a bad delivery.
 */
export async function verifyWebhookEvent(
  rawBody: string,
  signatureHeader: string | null,
): Promise<unknown> {
  const { webhookSecret } = readConfig();
  if (!webhookSecret) throw new VoiceMisconfiguredError("ELEVENLABS_WEBHOOK_SECRET is not set");
  if (!signatureHeader) throw new WebhookRejectedError("Missing signature header");

  // No API key needed: verification is local.
  const client = new ElevenLabsClient({ apiKey: "unused" });
  try {
    return await client.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
  } catch {
    // The SDK's message names which check failed; none of it is useful to
    // keep, and the payload must not travel with it.
    throw new WebhookRejectedError();
  }
}

/**
 * SDK failures into the app's taxonomy. The SDK error is never kept as
 * `cause`: its body can echo the request.
 */
function toVoiceError(error: unknown): AppError {
  if (error instanceof ElevenLabsTimeoutError) {
    return new VoiceUnavailableError(`ElevenLabs timed out after ${TOKEN_TIMEOUT_SECONDS}s`);
  }
  if (error instanceof ElevenLabsError) {
    const status = error.statusCode;
    if (status === undefined) {
      return new VoiceUnavailableError("ElevenLabs is not reachable");
    }
    if (status === 401 || status === 403) {
      return new VoiceMisconfiguredError(`ElevenLabs rejected the API key (HTTP ${status})`);
    }
    if (status === 404 || status === 422 || status === 400) {
      return new VoiceMisconfiguredError(`ElevenLabs rejected the agent or request (HTTP ${status})`);
    }
    // 429 and 5xx: the platform, not our configuration. Retrying can work.
    return new VoiceUnavailableError(`ElevenLabs failed (HTTP ${status})`);
  }
  return new VoiceUnavailableError(
    `ElevenLabs call failed with ${error instanceof Error ? error.name : typeof error}`,
  );
}

/** `exp` of a JWT-shaped token, or null when it has none or is not a JWT. */
function tokenExpiry(token: string): Date | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}
