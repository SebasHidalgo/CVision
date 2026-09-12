import { vi } from "vitest";

/**
 * Test double for the model provider behind `lib/ai/client.ts`, stubbed at the
 * HTTP boundary (global `fetch`) so the client's own request building, timeout
 * and error handling all run for real.
 *
 * This is the only test file that knows the provider's wire format (today:
 * Ollama's /api/chat). When the provider changes, rewrite this file to speak
 * the new format; the contract tests in `client.test.ts` must not change.
 */

/** What the client asked the model, normalized across providers. */
export type ProviderRequest = {
  system: string | undefined;
  prompt: string;
  /** JSON Schema sent for constrained decoding; `null` means plain JSON mode. */
  schema: Record<string, unknown> | null;
};

export type ProviderReply =
  | { kind: "answer"; content: string; delayMs?: number }
  | { kind: "hang" }
  | { kind: "refuse" }
  | { kind: "error"; status: number };

export const reply = {
  /** The model answers with this raw text, optionally after a delay. */
  answer: (content: string, delayMs?: number): ProviderReply => ({
    kind: "answer",
    content,
    delayMs,
  }),
  /** The model answers with this value serialized as JSON. */
  json: (value: unknown): ProviderReply => ({
    kind: "answer",
    content: JSON.stringify(value),
  }),
  /** The provider accepts the request and never answers. */
  hang: (): ProviderReply => ({ kind: "hang" }),
  /** Nothing is listening: the connection is refused. */
  refuse: (): ProviderReply => ({ kind: "refuse" }),
  /** The provider answers with an HTTP error status. */
  error: (status: number): ProviderReply => ({ kind: "error", status }),
};

/**
 * Routes every provider call to `handler`. Returns the normalized requests the
 * client sent, in order.
 */
export function installFakeProvider(
  handler: (request: ProviderRequest) => ProviderReply,
): { requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];

  vi.stubGlobal(
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = toProviderRequest(init);
      requests.push(request);
      return respond(handler(request), init?.signal ?? undefined);
    },
  );

  return { requests };
}

type OllamaChatBody = {
  messages: { role: string; content: string }[];
  format?: unknown;
};

function toProviderRequest(init?: RequestInit): ProviderRequest {
  const body = JSON.parse(String(init?.body)) as OllamaChatBody;
  const format = body.format;

  return {
    system: body.messages.find((message) => message.role === "system")?.content,
    prompt:
      body.messages.filter((message) => message.role === "user").at(-1)
        ?.content ?? "",
    schema:
      typeof format === "object" && format !== null
        ? (format as Record<string, unknown>)
        : null,
  };
}

async function respond(
  providerReply: ProviderReply,
  signal: AbortSignal | undefined,
): Promise<Response> {
  switch (providerReply.kind) {
    case "hang":
      return new Promise<Response>((_, reject) => rejectOnAbort(signal, reject));

    case "refuse":
      // What Node's fetch throws when nothing listens on the port.
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), {
          code: "ECONNREFUSED",
        }),
      });

    case "error":
      return jsonResponse(
        { error: `provider failed with status ${providerReply.status}` },
        providerReply.status,
      );

    case "answer":
      if (providerReply.delayMs) await delay(providerReply.delayMs, signal);
      return jsonResponse({
        model: "fake-model",
        created_at: new Date().toISOString(),
        message: { role: "assistant", content: providerReply.content },
        done: true,
        done_reason: "stop",
      });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Rejects with the signal's reason when aborted, like Node's fetch does. */
function rejectOnAbort(
  signal: AbortSignal | undefined,
  reject: (reason: unknown) => void,
) {
  if (!signal) return;
  if (signal.aborted) return reject(signal.reason);
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    rejectOnAbort(signal, (reason) => {
      clearTimeout(timer);
      reject(reason);
    });
  });
}
