import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiMisconfiguredError, AiRateLimitedError } from "@/lib/error/errors";
import { generateJson, rateLimitDetails } from "./client";
import { installFakeProvider, reply } from "./client.stub";

/*
 * Wire-level facts about the Google provider that the provider-agnostic
 * contract in client.test.ts cannot see: which model is addressed, how thinking
 * is configured, how credentials are read. Rewrite with the provider.
 */

const schema = z.object({ ok: z.boolean() });

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to fail, but it resolved");
}

describe("Google provider: configuration", () => {
  it("addresses gemini-3.5-flash-lite unless AI_MODEL says otherwise", async () => {
    vi.stubEnv("AI_MODEL", "");
    const { requests } = installFakeProvider(() => reply.json({ ok: true }));

    await generateJson({ prompt: "p", schema });

    expect(requests[0].model).toBe("gemini-3.5-flash-lite");
  });

  it("addresses the model named in AI_MODEL", async () => {
    vi.stubEnv("AI_MODEL", "gemini-2.5-flash-lite");
    const { requests } = installFakeProvider(() => reply.json({ ok: true }));

    await generateJson({ prompt: "p", schema });

    expect(requests[0].model).toBe("gemini-2.5-flash-lite");
  });

  it("sends the key from GOOGLE_GENERATIVE_AI_API_KEY", async () => {
    const { requests } = installFakeProvider(() => reply.json({ ok: true }));
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "key-from-env");

    await generateJson({ prompt: "p", schema });

    expect(requests[0].apiKey).toBe("key-from-env");
  });

  it("fails as misconfigured, without a request, when the key is missing", async () => {
    const { requests } = installFakeProvider(() => reply.json({ ok: true }));
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");

    const error = await failureOf(generateJson({ prompt: "p", schema }));

    expect(error).toBeInstanceOf(AiMisconfiguredError);
    expect(requests).toHaveLength(0);
  });

  it("fails as misconfigured, without a request, for an unknown AI_PROVIDER", async () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    const { requests } = installFakeProvider(() => reply.json({ ok: true }));

    const error = await failureOf(generateJson({ prompt: "p", schema }));

    expect(error).toBeInstanceOf(AiMisconfiguredError);
    expect(requests).toHaveLength(0);
  });
});

describe("Google provider: request shape", () => {
  // Thinking bills as output tokens. The previous model's unconfigured default
  // produced 266 output tokens for a 20-token task; never leave it implicit.
  it("pins thinking to the lowest level Gemini 3.x accepts", async () => {
    vi.stubEnv("AI_MODEL", "gemini-3.5-flash-lite");
    const { requests } = installFakeProvider(() => reply.json({ ok: true }));

    await generateJson({ prompt: "p", schema });

    expect(requests[0].thinking).toEqual({ thinkingLevel: "minimal" });
  });

  it("disables thinking outright on a Gemini 2.5 model", async () => {
    vi.stubEnv("AI_MODEL", "gemini-2.5-flash-lite");
    const { requests } = installFakeProvider(() => reply.json({ ok: true }));

    await generateJson({ prompt: "p", schema });

    expect(requests[0].thinking).toEqual({ thinkingBudget: 0 });
  });

  it("makes exactly one attempt per call: a 503 is not retried", async () => {
    const { requests } = installFakeProvider(() => reply.error(503));

    await failureOf(generateJson({ prompt: "p", schema }));

    expect(requests).toHaveLength(1);
  });

  it("sends the score fields as plain numbers, not number-or-string", async () => {
    const { requests } = installFakeProvider(() => reply.json({}));
    const { resumeFeedbackSchema } = await import("@/lib/schemas/resumeSchema");

    await failureOf(generateJson({ prompt: "p", schema: resumeFeedbackSchema }));

    const overall = (requests[0].schema?.properties as Record<string, { properties: Record<string, unknown> }>).overall;
    expect(overall.properties.qualityScore).toMatchObject({ type: "number" });
  });
});

describe("Google provider: a 429 is logged with its quota, never its message", () => {
  const QUOTA_FAILURE = {
    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
    violations: [
      {
        quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
        quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
        quotaDimensions: { location: "global", model: "gemini-3.5-flash-lite" },
        quotaValue: "15",
      },
    ],
  };
  const RETRY_INFO = { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" };

  it("writes one structured line naming the quota and the suggested wait, and fails as rate-limited", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installFakeProvider(() => reply.error(429, [QUOTA_FAILURE, { "@type": "type.googleapis.com/google.rpc.Help" }, RETRY_INFO]));

    const error = await failureOf(generateJson({ prompt: "p", schema }));

    expect(error).toBeInstanceOf(AiRateLimitedError);
    const line = warn.mock.calls.map((call) => String(call[0])).find((text) => text.includes("rate limited"));
    expect(line).toBe(
      "[CVision][ai] rate limited: http=429 status=RESOURCE_EXHAUSTED model=gemini-3.5-flash-lite quotaMetric=generativelanguage.googleapis.com/generate_content_free_tier_requests quotaId=GenerateRequestsPerMinutePerProjectPerModel-FreeTier quotaValue=15 retryDelay=34s retryAfter=?",
    );
    expect(line).not.toContain("provider failed with status");
  });

  it("still logs the line, with unknowns, when the body carries no details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installFakeProvider(() => reply.error(429));

    await failureOf(generateJson({ prompt: "p", schema }));

    const line = warn.mock.calls.map((call) => String(call[0])).find((text) => text.includes("rate limited"));
    expect(line).toContain("quotaId=? quotaValue=? retryDelay=? retryAfter=?");
  });

  it("reads the Retry-After header and tolerates a body that is not Google's shape", () => {
    expect(rateLimitDetails({ error: { status: "RESOURCE_EXHAUSTED", details: [RETRY_INFO] } }, { "retry-after": "30" })).toEqual({
      status: "RESOURCE_EXHAUSTED",
      quotaMetric: "?",
      quotaId: "?",
      quotaValue: "?",
      retryDelay: "34s",
      retryAfter: "30",
    });
    expect(rateLimitDetails("not json", undefined)).toEqual({
      status: "?",
      quotaMetric: "?",
      quotaId: "?",
      quotaValue: "?",
      retryDelay: "?",
      retryAfter: "?",
    });
  });
});
