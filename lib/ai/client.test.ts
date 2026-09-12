import { inspect } from "node:util";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { AiFormatError, AiUnavailableError } from "@/lib/error/errors";
import { resumeFeedbackSchema } from "@/lib/schemas/resumeSchema";
import { generateJson } from "./client";
import { installFakeProvider, reply, type ProviderReply } from "./client.stub";
import { feedbackSchema } from "./schemas";
import { extractTechstackFromDescription } from "./techstack";

/*
 * Contract of `generateJson`, independent of the provider behind it. The
 * provider is faked at the HTTP boundary by ./client.stub, the only file that
 * knows its wire format. Nothing in this file may depend on which provider it is.
 */

const PROMPT_MARKER = "PROMPT-MARKER-7f3a";
const RESPONSE_MARKER = "RESPONSE-MARKER-9c1e";

// The metadata line generateJson logs per call. scripts/eval reads provider
// and model from it, so its shape is part of the contract.
const AI_LOG_LINE = /^\[CVision\]\[ai\] provider=\S+ model=\S+ ms=\d+$/;

const simpleSchema = z.object({ score: z.number(), label: z.string() });

/** Everything an error exposes when logged: message, stack and cause chain. */
function everythingIn(error: unknown): string {
  return inspect(error, { depth: 10 });
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to fail, but it resolved");
}

function captureConsole(): string[] {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(
        args
          .map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 10 })))
          .join(" "),
      );
    });
  }
  return lines;
}

describe("generateJson: answers that satisfy the schema", () => {
  it("returns the schema's parsed output, typed", async () => {
    const schema = z.object({ score: z.coerce.number(), label: z.string() });
    installFakeProvider(() => reply.json({ score: "85", label: "ok" }));

    const result = await generateJson({ prompt: "p", schema });

    expect(result).toEqual({ score: 85, label: "ok" });
    expectTypeOf(result).toEqualTypeOf<{ score: number; label: string }>();
  });

  it.each([
    { fence: "a json-tagged fence", content: '```json\n{"score":1,"label":"a"}\n```' },
    { fence: "a bare fence", content: '```\n{"score":1,"label":"a"}\n```' },
    {
      fence: "a fence with surrounding whitespace",
      content: '\n  ```JSON\n{"score":1,"label":"a"}\n```  \n',
    },
  ])("strips $fence before parsing", async ({ content }) => {
    installFakeProvider(() => reply.answer(content));

    await expect(generateJson({ prompt: "p", schema: simpleSchema })).resolves.toEqual({
      score: 1,
      label: "a",
    });
  });

  it("sends the prompt and the system prompt to the model", async () => {
    const { requests } = installFakeProvider(() => reply.json({ score: 1, label: "a" }));

    await generateJson({ prompt: "the prompt", system: "the system", schema: simpleSchema });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ prompt: "the prompt", system: "the system" });
  });

  it("sends no system prompt when none is given", async () => {
    const { requests } = installFakeProvider(() => reply.json({ score: 1, label: "a" }));

    await generateJson({ prompt: "the prompt", schema: simpleSchema });

    expect(requests[0].system).toBeUndefined();
  });
});

describe("generateJson: structured output", () => {
  // resumeFeedbackSchema and feedbackSchema are exported and used by Server
  // Actions. The techstack schema is private to lib/ai/techstack.ts, so it is
  // observed through the function that uses it.
  it.each<{ name: string; schema: z.ZodType; property: string }>([
    { name: "resume analysis", schema: resumeFeedbackSchema, property: "atsCompatibility" },
    { name: "interview feedback", schema: feedbackSchema, property: "categoryScores" },
  ])(
    "sends the $name schema as JSON Schema, not plain JSON mode",
    async ({ schema, property }) => {
      const { requests } = installFakeProvider(() => reply.json({}));

      await failureOf(generateJson({ prompt: "p", schema }));

      expect(requests).toHaveLength(1);
      expect(requests[0].schema).not.toBeNull();
      expect(requests[0].schema?.properties).toHaveProperty(property);
    },
  );

  it("sends the techstack schema as JSON Schema, not plain JSON mode", async () => {
    const { requests } = installFakeProvider(() =>
      reply.json({ techstack: ["Go", "Kafka"] }),
    );

    await expect(extractTechstackFromDescription("Go and Kafka")).resolves.toEqual([
      "Go",
      "Kafka",
    ]);
    expect(requests[0].schema?.properties).toHaveProperty("techstack");
  });

  it("falls back to plain JSON mode for a schema JSON Schema cannot express, and still validates", async () => {
    const schema = z.custom<{ ok: true }>(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        (value as { ok?: unknown }).ok === true,
    );
    const { requests } = installFakeProvider(() => reply.json({ ok: true }));

    await expect(generateJson({ prompt: "p", schema })).resolves.toEqual({ ok: true });
    expect(requests[0].schema).toBeNull();
  });
});

describe("generateJson: failure modes", () => {
  it.each<{
    when: string;
    answer: ProviderReply;
    errorClass: typeof AiUnavailableError | typeof AiFormatError;
    code: string;
  }>([
    { when: "the provider never answers", answer: reply.hang(), errorClass: AiUnavailableError, code: "AI_UNAVAILABLE" },
    { when: "the provider is unreachable", answer: reply.refuse(), errorClass: AiUnavailableError, code: "AI_UNAVAILABLE" },
    { when: "the provider answers HTTP 500", answer: reply.error(500), errorClass: AiUnavailableError, code: "AI_UNAVAILABLE" },
    { when: "the answer is prose, not JSON", answer: reply.answer("Here is the analysis you asked for."), errorClass: AiFormatError, code: "AI_BAD_FORMAT" },
    { when: "the answer is truncated JSON", answer: reply.answer('{"score": 1, "label": "unfinish'), errorClass: AiFormatError, code: "AI_BAD_FORMAT" },
    { when: "the JSON breaks the schema", answer: reply.json({ score: "high", label: 3 }), errorClass: AiFormatError, code: "AI_BAD_FORMAT" },
  ])("throws $code when $when", async ({ answer, errorClass, code }) => {
    installFakeProvider(() => answer);

    const error = await failureOf(
      generateJson({ prompt: "p", schema: simpleSchema, timeoutMs: 50 }),
    );

    expect(error).toBeInstanceOf(errorClass);
    expect(error).toMatchObject({ code });
  });

  it("gives up at its timeout instead of waiting for the provider", async () => {
    installFakeProvider(() => reply.hang());
    const startedAt = Date.now();

    const error = await failureOf(
      generateJson({ prompt: "p", schema: simpleSchema, timeoutMs: 50 }),
    );

    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("applies each call's timeout to that call only", async () => {
    installFakeProvider((request) =>
      request.prompt === "slow"
        ? reply.hang()
        : reply.answer(JSON.stringify({ score: 1, label: "a" }), 150),
    );

    const [slow, patient] = await Promise.allSettled([
      generateJson({ prompt: "slow", schema: simpleSchema, timeoutMs: 50 }),
      generateJson({ prompt: "patient", schema: simpleSchema, timeoutMs: 5_000 }),
    ]);

    expect(slow.status === "rejected" && slow.reason).toBeInstanceOf(AiUnavailableError);
    expect(patient).toEqual({ status: "fulfilled", value: { score: 1, label: "a" } });
  });
});

describe("generateJson: no prompt or response content in errors or logs", () => {
  const failures: { when: string; answer: ProviderReply }[] = [
    { when: "the provider never answers", answer: reply.hang() },
    { when: "the provider is unreachable", answer: reply.refuse() },
    { when: "the provider answers with an HTTP error", answer: reply.error(503) },
    { when: "the answer is not JSON", answer: reply.answer("plain prose") },
    { when: "the answer breaks the schema", answer: reply.json({ score: RESPONSE_MARKER, label: "a" }) },
  ];

  it.each(failures)("keeps the prompt out of the error when $when", async ({ answer }) => {
    installFakeProvider(() => answer);

    const error = await failureOf(
      generateJson({
        prompt: `CV text ${PROMPT_MARKER}`,
        system: `system ${PROMPT_MARKER}`,
        schema: simpleSchema,
        timeoutMs: 50,
      }),
    );

    expect(everythingIn(error)).not.toContain(PROMPT_MARKER);
  });

  it("names the failing schema path, never the offending value", async () => {
    installFakeProvider(() => reply.json({ score: RESPONSE_MARKER, label: "a" }));

    const error = await failureOf(generateJson({ prompt: "p", schema: simpleSchema }));

    expect(error).toBeInstanceOf(AiFormatError);
    expect((error as Error).message).toContain("score");
    expect(everythingIn(error)).not.toContain(RESPONSE_MARKER);
  });

  // KNOWN DEFECT, fails today: for unparseable output the AiFormatError keeps
  // JSON.parse's SyntaxError as its `cause`, and V8 quotes about ten characters
  // of the input around the parse error in that message (all of it when it is
  // that short). Anything that logs the error (toActionError does) writes that
  // slice of the model's answer to the logs. Drop `.fails` once fixed.
  it.fails("keeps the model's answer out of the error when it is not JSON", async () => {
    // Short on purpose: a longer marker would only be partly quoted.
    const shortAnswer = "LEAK-7f3a";
    installFakeProvider(() => reply.answer(shortAnswer));

    const error = await failureOf(generateJson({ prompt: "p", schema: simpleSchema }));

    expect(everythingIn(error)).not.toContain(shortAnswer);
  });

  it("logs exactly one metadata line on success: provider, model and duration", async () => {
    const lines = captureConsole();
    installFakeProvider(() => reply.json({ score: 1, label: RESPONSE_MARKER }));

    await generateJson({ prompt: PROMPT_MARKER, system: PROMPT_MARKER, schema: simpleSchema });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(AI_LOG_LINE);
  });

  it.each(failures)("logs only the metadata line when $when", async ({ answer }) => {
    const lines = captureConsole();
    installFakeProvider(() => answer);

    await failureOf(
      generateJson({ prompt: PROMPT_MARKER, schema: simpleSchema, timeoutMs: 50 }),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(AI_LOG_LINE);
  });
});

describe("test isolation", () => {
  it("cannot reach the network: an unstubbed fetch fails before connecting", async () => {
    const error = await failureOf(fetch("http://127.0.0.1:11434/api/tags"));

    expect(everythingIn(error)).toContain("Network access is blocked in tests");
  });
});
