import "server-only";

import { Ollama } from "ollama";
import { z } from "zod";
import { AiFormatError, AiUnavailableError } from "@/lib/error/errors";

/**
 * Provider-agnostic AI interface. Nothing else in the app talks to Ollama
 * directly, and no caller picks a provider: adding a paid one means a new
 * `call<Provider>` function and a branch here, with zero call-site changes.
 */
export type AiProvider = "ollama";

const PROVIDER: AiProvider = "ollama";
const MODEL = "qwen3:1.7b";
const OLLAMA_HOST = "http://127.0.0.1:11434";

const DEFAULT_TIMEOUT_MS = 90_000;

// Ollama defaults to a very small context window and silently drops whatever
// does not fit — a truncated resume or transcript still returns valid-looking
// JSON. Set it explicitly so the input is the one we actually sent.
const NUM_CTX = 8192;

type GenerateJsonOptions<T> = {
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
  prompt,
  system,
  schema,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: GenerateJsonOptions<T>): Promise<T> {
  const startedAt = Date.now();

  try {
    return await callOllama(prompt, system, schema, timeoutMs);
  } finally {
    // Never log the prompt or the response: both carry the resume and the job
    // description.
    console.info(
      `[CVision][ai] provider=${PROVIDER} model=${MODEL} ms=${Date.now() - startedAt}`,
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
    host: OLLAMA_HOST,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: controller.signal })) as typeof fetch,
  });

  let content: string;
  try {
    const response = await client.chat({
      model: MODEL,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
      ],
      // Constrained decoding: keeps a small model from answering with prose.
      format: toJsonSchemaOrJsonMode(schema),
      options: { num_ctx: NUM_CTX },
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
