import { vi } from "vitest";

/**
 * Test double for the model provider behind `lib/ai/client.ts`, stubbed at the
 * HTTP boundary (global `fetch`) so the client's own request building, timeout
 * and error handling all run for real.
 *
 * This is the only test file that knows the provider's wire format (today:
 * Google's Generative Language API, `models/{model}:generateContent`). When the
 * provider changes, rewrite this file to speak the new format; the contract
 * tests in `client.test.ts` must not change.
 */

/** What the client asked the model, normalized across providers. */
export type ProviderRequest = {
  system: string | undefined;
  prompt: string;
  /** JSON Schema sent for constrained decoding; `null` means plain JSON mode. */
  schema: Record<string, unknown> | null;
  /** Model id the request was addressed to. */
  model: string;
  /** Thinking / reasoning configuration as sent; `undefined` means provider default. */
  thinking: unknown;
  /** Sampling temperature as sent; `undefined` means the provider's default. */
  temperature: number | undefined;
  /** Sampling seed as sent; `undefined` means none was sent. */
  seed: number | undefined;
  /** Credential presented to the provider. */
  apiKey: string | undefined;
};

export type ProviderReply =
  | { kind: "answer"; content: string; delayMs?: number }
  | { kind: "hang" }
  | { kind: "refuse" }
  | { kind: "error"; status: number }
  | { kind: "blocked-prompt" }
  | { kind: "blocked-answer"; partial?: string }
  | { kind: "truncated"; content: string };

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
  /** The provider's safety filter rejects the prompt before generating. */
  blockedPrompt: (): ProviderReply => ({ kind: "blocked-prompt" }),
  /** The safety filter stops the answer mid-way, with or without partial text. */
  blockedAnswer: (partial?: string): ProviderReply => ({
    kind: "blocked-answer",
    partial,
  }),
  /** The answer hits the output token limit with this (cut) text. */
  truncated: (content: string): ProviderReply => ({
    kind: "truncated",
    content,
  }),
};

const TEST_API_KEY = "test-api-key";

/**
 * Routes every provider call to `handler`. Returns the normalized requests the
 * client sent, in order. Also provides a credential, so a test that wants a
 * missing one must clear it after calling this.
 */
export function installFakeProvider(
  handler: (request: ProviderRequest) => ProviderReply,
): { requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];

  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", TEST_API_KEY);
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = toProviderRequest(input, init);
      requests.push(request);
      return respond(handler(request), init?.signal ?? undefined);
    },
  );

  return { requests };
}

type GooglePart = { text?: string };

type GoogleGenerateContentBody = {
  systemInstruction?: { parts: GooglePart[] };
  contents: { role: string; parts: GooglePart[] }[];
  generationConfig?: {
    responseMimeType?: string;
    responseSchema?: unknown;
    thinkingConfig?: unknown;
    temperature?: number;
    seed?: number;
  };
};

function toProviderRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): ProviderRequest {
  const body = JSON.parse(String(init?.body)) as GoogleGenerateContentBody;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const responseSchema = body.generationConfig?.responseSchema;

  return {
    system: body.systemInstruction?.parts.map((part) => part.text ?? "").join("\n"),
    prompt:
      body.contents
        .filter((content) => content.role === "user")
        .at(-1)
        ?.parts.map((part) => part.text ?? "")
        .join("\n") ?? "",
    schema:
      typeof responseSchema === "object" && responseSchema !== null
        ? (responseSchema as Record<string, unknown>)
        : null,
    model: /\/models\/([^:/]+):generateContent/.exec(url)?.[1] ?? "",
    thinking: body.generationConfig?.thinkingConfig,
    temperature: body.generationConfig?.temperature,
    seed: body.generationConfig?.seed,
    apiKey: new Headers(init?.headers).get("x-goog-api-key") ?? undefined,
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
        cause: Object.assign(
          new Error("connect ECONNREFUSED 142.250.0.1:443"),
          { code: "ECONNREFUSED" },
        ),
      });

    case "error":
      return jsonResponse(
        {
          error: {
            code: providerReply.status,
            message: `provider failed with status ${providerReply.status}`,
            status: googleStatusFor(providerReply.status),
          },
        },
        providerReply.status,
      );

    case "answer":
      if (providerReply.delayMs) await delay(providerReply.delayMs, signal);
      return jsonResponse(generateContentResponse(providerReply.content, "STOP"));

    case "truncated":
      return jsonResponse(
        generateContentResponse(providerReply.content, "MAX_TOKENS"),
      );

    case "blocked-answer":
      return jsonResponse(
        generateContentResponse(providerReply.partial, "SAFETY"),
      );

    case "blocked-prompt":
      return jsonResponse({
        promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
      });
  }
}

function generateContentResponse(text: string | undefined, finishReason: string) {
  return {
    candidates: [
      {
        content:
          text === undefined ? undefined : { role: "model", parts: [{ text }] },
        finishReason,
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
    modelVersion: "fake-model",
  };
}

function googleStatusFor(status: number): string {
  const known: Record<number, string> = {
    400: "INVALID_ARGUMENT",
    401: "UNAUTHENTICATED",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
    429: "RESOURCE_EXHAUSTED",
    500: "INTERNAL",
    503: "UNAVAILABLE",
  };
  return known[status] ?? "UNKNOWN";
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
