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

/**
 * Sampling is pinned, not left to the provider. This is a structured
 * extraction task: the same resume against the same posting should produce
 * the same analysis, and a user who re-runs one CV and gets a different
 * answer reads the tool as a coin flip. It also sets the noise floor every
 * prompt change has to clear, which M2d measured at the provider default: one
 * eval fixture's quality score spanned 25-75 across nine runs whose prompts
 * differed by at most two comment lines.
 *
 * The API accepts [0.0, 2.0] for this model and rejects anything outside it
 * with 400 INVALID_ARGUMENT, so 0 is the floor. `seed`, `topP` and `topK` are
 * accepted too and are not set: at temperature 0 they constrain a choice that
 * is already the argmax, and an unused knob is one more thing to explain.
 */
const DEFAULT_TEMPERATURE = 0;
const TEMPERATURE_RANGE = { min: 0, max: 2 } as const;

/**
 * A fixed seed, and the lever that actually works. Measured in M2d over six
 * runs per arm on two fixtures, interleaved in one session:
 *
 *   provider default   6 distinct outputs of 6, quality spanning 12 points
 *   temperature 0      6 distinct outputs of 6, quality spanning 15 points
 *   temperature 0 + this seed   1 distinct output of 6, byte for byte
 *
 * Temperature alone narrowed the dimension scores by about a quarter and
 * removed nothing: greedy decoding is not reproducible on a model served at
 * this scale. With the seed, the same resume and posting return the same
 * analysis, which is what a user re-uploading one CV expects, and it turns a
 * three-run eval set from a statistical exercise into a check.
 *
 * The number is arbitrary and was chosen before any of this was measured.
 * It must stay that way: picking a seed because its draw scores better is
 * fitting the instrument to the observation. What it buys is reproducibility,
 * not correctness - one fixed draw also freezes whatever that draw gets
 * wrong, which is a bug made legible rather than a bug introduced.
 */
const DEFAULT_SEED: number | null = 7;

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

type CallMeta = {
  input: number | undefined;
  output: number | undefined;
  /** What the provider says answered; null when it does not say. */
  modelVersion: string | null;
};

type AiConfig = {
  provider: string;
  model: string;
  /** `null` means: send no temperature and let the provider choose. */
  temperature: number | null;
  /** `null` means: send no seed. */
  seed: number | null;
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
  const meta: CallMeta = {
    input: undefined,
    output: undefined,
    modelVersion: null,
  };

  try {
    if (config.provider !== DEFAULT_PROVIDER) {
      throw new AiMisconfiguredError(
        `Unsupported AI_PROVIDER "${config.provider}"`,
      );
    }
    return await callGoogle(config, prompt, system, schema, timeoutMs, files, meta);
  } finally {
    // Never log the prompt or the response: both carry the resume and the job
    // description. Token counts are safe, and they are what an analysis costs.
    // scripts/eval reads provider, model, version, sampling and tokens
    // from this line, so a run file can say what produced it.
    console.info(
      `[CVision][ai] provider=${config.provider} model=${config.model} ver=${meta.modelVersion ?? "?"} temp=${config.temperature ?? "provider"} seed=${config.seed ?? "none"} ms=${Date.now() - startedAt} in=${meta.input ?? "?"} out=${meta.output ?? "?"}`,
    );
  }
}

// Read per call, not at import: the module is loaded before env in some
// tooling (tests, scripts), and a missing key must fail the call, not the boot.
function readConfig(): AiConfig {
  return {
    provider: process.env.AI_PROVIDER?.trim() || DEFAULT_PROVIDER,
    model: process.env.AI_MODEL?.trim() || DEFAULT_MODEL,
    temperature: readTemperature(),
    seed: readSeed(),
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || undefined,
  };
}

/**
 * `AI_TEMPERATURE` exists so an eval can capture a control arm beside a
 * change without editing code; production leaves it unset. "provider" omits
 * the field entirely, which is the only way to reproduce how every run before
 * M2d was sampled. An unusable value falls back to the default rather than
 * failing: a typo in an env var must not cost a paid analysis.
 */
function readTemperature(): number | null {
  const raw = process.env.AI_TEMPERATURE?.trim();
  if (!raw) return DEFAULT_TEMPERATURE;
  if (raw.toLowerCase() === "provider") return null;

  const value = Number(raw);
  if (
    Number.isFinite(value) &&
    value >= TEMPERATURE_RANGE.min &&
    value <= TEMPERATURE_RANGE.max
  ) {
    return value;
  }
  console.warn(
    `[CVision][ai] ignoring AI_TEMPERATURE=${raw}: not "provider" nor a number in [${TEMPERATURE_RANGE.min}, ${TEMPERATURE_RANGE.max}]`,
  );
  return DEFAULT_TEMPERATURE;
}

/** `AI_SEED` overrides the pinned seed for one run, the same way as above. */
function readSeed(): number | null {
  const raw = process.env.AI_SEED?.trim();
  if (!raw) return DEFAULT_SEED;
  if (raw.toLowerCase() === "none") return null;

  const value = Number(raw);
  if (Number.isInteger(value) && value >= 0) return value;
  console.warn(`[CVision][ai] ignoring AI_SEED=${raw}: not a non-negative integer`);
  return DEFAULT_SEED;
}

/**
 * Which model actually answered. Google echoes the requested alias here
 * rather than a dated build, so this catches the model being renamed or
 * redirected to a different name - not an alias quietly re-pointed at a new
 * build behind the same name. The models listing is the only place the dated
 * version appears, and scripts/eval records it per run.
 */
function readModelVersion(body: unknown): string | null {
  const value = (body as { modelVersion?: unknown } | null | undefined)
    ?.modelVersion;
  return typeof value === "string" ? value : null;
}

async function callGoogle<T>(
  config: AiConfig,
  prompt: string,
  system: string | undefined,
  schema: z.ZodType<T>,
  timeoutMs: number,
  files: AiFile[] | undefined,
  meta: CallMeta,
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
      // Pinned above, and omitted entirely when AI_TEMPERATURE=provider so
      // a control arm can reproduce the old sampling.
      ...(config.temperature === null ? {} : { temperature: config.temperature }),
      ...(config.seed === null ? {} : { seed: config.seed }),
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
    meta.input = result.usage.inputTokens;
    meta.output = result.usage.outputTokens;
    meta.modelVersion = readModelVersion(result.response?.body);
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
