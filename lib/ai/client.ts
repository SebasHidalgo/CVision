import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  APICallError,
  generateObject,
  jsonSchema,
  JSONParseError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
} from "ai";
import { z } from "zod";
import {
  AiContentBlockedError,
  AiFormatError,
  AiMisconfiguredError,
  AiRateLimitedError,
  AiUnavailableError,
  type AppError,
} from "@/lib/error/errors";

/**
 * Provider-agnostic AI interface. Nothing else in the app talks to a model
 * provider directly, and no caller picks one: adding a provider means a new
 * `call<Provider>` function and a branch in `generateJson`, with zero
 * call-site changes.
 */
export type AiProvider = "google";

const DEFAULT_PROVIDER: AiProvider = "google";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 30_000;

/** A document sent to the model alongside the prompt. */
export type AiFile = { data: Uint8Array; mediaType: string };

type GenerateJsonOptions<T> = {
  prompt: string;
  system?: string;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  /**
   * Experimental, and no production caller sets it: scripts/eval uses it to
   * compare sending a CV as a PDF against sending its extracted text.
   */
  files?: AiFile[];
};

type Usage = { input: number | undefined; output: number | undefined };

type AiConfig = {
  provider: string;
  model: string;
  apiKey: string | undefined;
};

/**
 * Asks the model for JSON and returns it already validated. Either resolves to
 * a `T` that satisfies the schema, or throws an `AppError` subclass:
 * `AiUnavailableError` (timeout, network, provider outage),
 * `AiRateLimitedError`, `AiMisconfiguredError` (credentials, model, request),
 * `AiContentBlockedError` (safety refusal) or `AiFormatError` (answered
 * outside the contract).
 */
export async function generateJson<T>({
  prompt,
  system,
  schema,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  files,
}: GenerateJsonOptions<T>): Promise<T> {
  const config = readConfig();
  const startedAt = Date.now();
  const usage: Usage = { input: undefined, output: undefined };

  try {
    if (config.provider !== DEFAULT_PROVIDER) {
      throw new AiMisconfiguredError(
        `Unsupported AI_PROVIDER "${config.provider}"`,
      );
    }
    return await callGoogle(config, prompt, system, schema, timeoutMs, files, usage);
  } finally {
    // Never log the prompt or the response: both carry the resume and the job
    // description. Token counts are safe, and they are what an analysis costs.
    // scripts/eval reads provider, model and tokens from this line.
    console.info(
      `[CVision][ai] provider=${config.provider} model=${config.model} ms=${Date.now() - startedAt} in=${usage.input ?? "?"} out=${usage.output ?? "?"}`,
    );
  }
}

// Read per call, not at import: the module is loaded before env in some
// tooling (tests, scripts), and a missing key must fail the call, not the boot.
function readConfig(): AiConfig {
  return {
    provider: process.env.AI_PROVIDER?.trim() || DEFAULT_PROVIDER,
    model: process.env.AI_MODEL?.trim() || DEFAULT_MODEL,
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || undefined,
  };
}

async function callGoogle<T>(
  config: AiConfig,
  prompt: string,
  system: string | undefined,
  schema: z.ZodType<T>,
  timeoutMs: number,
  files: AiFile[] | undefined,
  usage: Usage,
): Promise<T> {
  if (!config.apiKey) {
    // Fail before any request: the SDK would fail the same way, but later and
    // with an error that carries the request body.
    throw new AiMisconfiguredError("GOOGLE_GENERATIVE_AI_API_KEY is not set");
  }

  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const responseSchema = toJsonSchemaOrNull(schema);

  let candidate: unknown;
  try {
    const request = {
      model: google(config.model),
      system,
      // Attachments travel as message parts; without them the plain prompt
      // form keeps the request byte-identical to what it has always been.
      ...(files?.length
        ? {
            messages: [
              {
                role: "user" as const,
                content: [
                  ...files.map((file) => ({ type: "file" as const, ...file })),
                  { type: "text" as const, text: prompt },
                ],
              },
            ],
          }
        : { prompt }),
      abortSignal: controller.signal,
      // One attempt per call, like the previous provider: the caller's timeout
      // is the whole budget, and a retry policy is a separate decision.
      maxRetries: 0,
      // Explicit, never the provider default: thinking bills as output tokens.
      // The SDK maps this to the lowest level the model accepts
      // (`thinkingLevel: "minimal"` on Gemini 3.x, `thinkingBudget: 0` on 2.5).
      reasoning: "none" as const,
      repairText: async ({ text }: { text: string }) => stripCodeFences(text),
    };

    // Constrained decoding when the schema is expressible as JSON Schema, plain
    // JSON mode otherwise. The SDK parses the JSON; validation stays here so
    // the guarantee below does not depend on a provider adapter.
    const result = responseSchema
      ? await generateObject({ ...request, schema: jsonSchema(responseSchema) })
      : await generateObject({ ...request, output: "no-schema" });
    candidate = result.object;
    usage.input = result.usage.inputTokens;
    usage.output = result.usage.outputTokens;
  } catch (error) {
    throw toAppError(error, timeoutMs);
  } finally {
    clearTimeout(timer);
  }

  return validate(candidate, schema);
}

/** The only exit: either a value that satisfies the schema, or AiFormatError. */
function validate<T>(candidate: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(candidate);
  if (!result.success) {
    // Failing paths only: issue values can carry resume text.
    throw new AiFormatError(
      `Model output failed schema at: ${result.error.issues
        .map((issue) => issue.path.join(".") || "(root)")
        .join(", ")}`,
    );
  }
  return result.data;
}

/**
 * Translates SDK failures into the app's taxonomy. Never keeps the SDK error
 * as `cause`: `APICallError` carries the request body (the prompt) and
 * `NoObjectGeneratedError` carries the model's text.
 */
function toAppError(error: unknown, timeoutMs: number): AppError {
  if (isAbortError(error)) {
    return new AiUnavailableError(`Gemini timed out after ${timeoutMs}ms`);
  }
  if (APICallError.isInstance(error)) return fromApiCallError(error);
  if (NoObjectGeneratedError.isInstance(error)) return fromNoObject(error);
  if (LoadAPIKeyError.isInstance(error)) {
    return new AiMisconfiguredError("Google API key could not be loaded");
  }
  // Unknown: the class name is safe to keep, the object may not be.
  return new AiUnavailableError(
    `Gemini call failed with ${error instanceof Error ? error.name : typeof error}`,
  );
}

function fromApiCallError(error: APICallError): AppError {
  const status = error.statusCode;

  if (status === undefined) {
    // Built by the SDK from the fetch failure; no request content in it.
    return new AiUnavailableError(`Gemini is not reachable: ${error.message}`);
  }

  const where = `HTTP ${status}${googleStatus(error.data)}`;

  if (status === 401 || status === 403) {
    return new AiMisconfiguredError(`Gemini rejected the API key (${where})`);
  }
  if (status === 429) {
    return new AiRateLimitedError(`Gemini rate limit or quota hit (${where})`);
  }
  if (status >= 200 && status < 300) {
    return new AiFormatError(`Gemini answered but the response was unreadable (${where})`);
  }
  if (status >= 500 || status === 408) {
    return new AiUnavailableError(`Gemini failed (${where})`);
  }
  // Remaining 4xx: bad model id, invalid key reported as 400, unsupported
  // schema feature. All operator problems.
  return new AiMisconfiguredError(`Gemini rejected the request (${where})`);
}

function fromNoObject(error: NoObjectGeneratedError): AppError {
  if (error.finishReason === "content-filter") {
    return new AiContentBlockedError("Gemini blocked the prompt or the answer");
  }
  if (error.finishReason === "length") {
    return new AiFormatError("Model output was cut off at the output token limit");
  }
  if (error.text === undefined) {
    return new AiFormatError(
      `Model returned no text (finish reason: ${error.finishReason ?? "unknown"})`,
    );
  }
  if (JSONParseError.isInstance(error.cause)) {
    return new AiFormatError("Model output was not valid JSON");
  }
  return new AiFormatError(
    `Model output could not be read (finish reason: ${error.finishReason ?? "unknown"})`,
  );
}

/** Google's status enum (e.g. RESOURCE_EXHAUSTED); never its free-text message. */
function googleStatus(data: unknown): string {
  const status = (data as { error?: { status?: unknown } } | null)?.error?.status;
  return typeof status === "string" ? ` ${status}` : "";
}

/**
 * The model can't reply in fences under JSON mode, but the contract tolerates
 * them. Returning null tells the SDK there is nothing to repair.
 */
function stripCodeFences(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return null;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

type JsonSchemaInput = Parameters<typeof jsonSchema>[0];

function toJsonSchemaOrNull<T>(schema: z.ZodType<T>): JsonSchemaInput | null {
  try {
    // Same conversion the SDK applies to a Zod schema; done here so an
    // inexpressible schema (z.custom, refinements at the root) can fall back
    // to plain JSON mode instead of failing the call.
    return z.toJSONSchema(schema, {
      target: "draft-7",
      io: "input",
    }) as JsonSchemaInput;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
