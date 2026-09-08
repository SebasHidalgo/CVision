import "server-only";

import { Ollama } from "ollama";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { AiFormatError, AiUnavailableError } from "@/lib/error/errors";

/**
 * Provider-agnostic AI interface. Nothing else in the app talks to Ollama or
 * the AI SDK directly, so swapping providers happens only in this file.
 */
export type AiProvider = "ollama" | "google";

const DEFAULT_TIMEOUT_MS = 90_000;

const MODELS: Record<AiProvider, string> = {
  ollama: process.env.OLLAMA_MODEL ?? "llama3.2:3b",
  google: process.env.GOOGLE_MODEL ?? "gemini-2.0-flash-001",
};

type GenerateJsonOptions<T> = {
  provider: AiProvider;
  prompt: string;
  system?: string;
  schema: z.ZodType<T>;
  timeoutMs?: number;
};

/**
 * Asks the model for JSON and returns it already validated. Either resolves to
 * a `T` that satisfies the schema, or throws `AiUnavailableError` (timeout or
 * provider down) or `AiFormatError` (answered outside the contract).
 */
export async function generateJson<T>({
  provider,
  prompt,
  system,
  schema,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: GenerateJsonOptions<T>): Promise<T> {
  const startedAt = Date.now();

  try {
    const raw =
      provider === "ollama"
        ? await callOllama(prompt, system, schema, timeoutMs)
        : await callGoogle(prompt, system, schema, timeoutMs);

    return raw;
  } finally {
    // Never log the prompt or the response: both carry the resume and the job
    // description.
    console.info(
      `[CVision][ai] provider=${provider} model=${MODELS[provider]} ms=${Date.now() - startedAt}`,
    );
  }
}

async function callOllama<T>(
  prompt: string,
  system: string | undefined,
  schema: z.ZodType<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // The ollama client only exposes a global abort, so the signal is injected
  // through fetch to keep the timeout per call.
  const client = new Ollama({
    host: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: controller.signal })) as typeof fetch,
  });

  let content: string;
  try {
    const response = await client.chat({
      model: MODELS.ollama,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
      ],
      // Constrained decoding: keeps a small model from answering with prose.
      format: toJsonSchemaOrJsonMode(schema),
    });
    content = response.message.content;
  } catch (error) {
    throw new AiUnavailableError(
      isAbort(error)
        ? `Ollama timed out after ${timeoutMs}ms`
        : "Ollama is not reachable",
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  return parseAndValidate(content, schema);
}

async function callGoogle<T>(
  prompt: string,
  system: string | undefined,
  schema: z.ZodType<T>,
  timeoutMs: number,
): Promise<T> {
  try {
    const { object } = await generateObject({
      model: google(MODELS.google),
      schema: schema as z.ZodType<T, unknown>,
      prompt,
      system,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return object;
  } catch (error) {
    if (isAbort(error)) {
      throw new AiUnavailableError(`Google timed out after ${timeoutMs}ms`, {
        cause: error,
      });
    }

    if (isSchemaFailure(error)) {
      throw new AiFormatError("Google returned an object outside the schema", {
        cause: error,
      });
    }
    throw new AiUnavailableError("Google provider failed", { cause: error });
  }
}

function parseAndValidate<T>(content: string, schema: z.ZodType<T>): T {
  let candidate: unknown;
  try {
    candidate = JSON.parse(stripCodeFences(content));
  } catch (error) {
    throw new AiFormatError("Model output was not valid JSON", {
      cause: error,
    });
  }

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

/** Small models often wrap the JSON in a fenced block. */
function stripCodeFences(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function toJsonSchemaOrJsonMode<T>(schema: z.ZodType<T>): string | object {
  try {
    return z.toJSONSchema(schema, { io: "input" });
  } catch {
    // Schemas that can't be serialized (z.custom, refinements) fall back to
    // plain JSON mode.
    return "json";
  }
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function isSchemaFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /NoObjectGenerated|TypeValidation|JSONParse/i.test(error.name)
  );
}
