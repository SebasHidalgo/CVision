import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/**
 * What the platform charged for a conversation, read from its own record.
 * No server-only import: the cost script and the voice e2e spec load it.
 */

export type ConversationCost = {
  conversationId: string;
  agentId: string | null;
  status: string;
  startedAt: Date | null;
  durationSeconds: number;
  /** Credits charged in total; null when the platform recorded none (a call that never ran). */
  credits: number | null;
  /** The split the platform reports, in credits, when it reports one. */
  callCredits: number | null;
  llmCredits: number | null;
  /** The platform's own dollar figure for the call, when present. */
  dollars: number | null;
  /** Charged at the burst rate. */
  burst: boolean;
  /** Seconds held in the queue before the agent picked up (not billed). */
  queueSeconds: number | null;
  failure: string | null;
};

function clientFor(apiKey: string): ElevenLabsClient {
  return new ElevenLabsClient({ apiKey, maxRetries: 0, timeoutInSeconds: 20 });
}

function requireKey(env: Record<string, string | undefined>): string {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set (see .env.template)");
  return apiKey;
}

/** One conversation's charge. Throws on any platform error; the caller prints it. */
export async function readConversationCost(conversationId: string, env: Record<string, string | undefined> = process.env): Promise<ConversationCost> {
  const record = await clientFor(requireKey(env)).conversationalAi.conversations.get(conversationId);
  const { metadata } = record;
  const charging = metadata.charging;
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    conversationId: record.conversationId,
    agentId: record.agentId ?? null,
    status: record.status,
    startedAt: metadata.startTimeUnixSecs ? new Date(metadata.startTimeUnixSecs * 1000) : null,
    durationSeconds: metadata.callDurationSecs ?? 0,
    credits: number(metadata.cost),
    callCredits: number(charging?.callCharge),
    llmCredits: number(charging?.llmCharge),
    dollars: number(metadata.costFiat),
    burst: charging?.isBurst === true,
    queueSeconds: number(metadata.queueWaitSecs),
    failure: metadata.error?.reason ? metadata.error.reason.replace(/\s+/g, " ").trim().slice(0, 160) : null,
  };
}

/** Ids of the conversations of these agents that started at or after `since`, newest first. */
export async function listConversationIds({
  agentIds,
  since,
  limit = 100,
  env = process.env,
}: {
  agentIds: string[];
  since: Date;
  limit?: number;
  env?: Record<string, string | undefined>;
}): Promise<string[]> {
  const client = clientFor(requireKey(env));
  const ids: string[] = [];
  for (const agentId of agentIds) {
    let cursor: string | undefined;
    do {
      const page = await client.conversationalAi.conversations.list({
        agentId,
        callStartAfterUnix: Math.floor(since.getTime() / 1000),
        pageSize: 100,
        ...(cursor ? { cursor } : {}),
      });
      for (const conversation of page.conversations) ids.push(conversation.conversationId);
      cursor = page.hasMore ? (page.nextCursor ?? undefined) : undefined;
    } while (cursor && ids.length < limit);
  }
  return ids.slice(0, limit);
}
