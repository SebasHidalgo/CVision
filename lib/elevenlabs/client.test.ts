import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteConversation, fetchConversation, missingPermission, readVoiceBalance } from "./client";

const API_KEY = "test-elevenlabs-key";

type Call = { url: URL; headers: Headers; method: string };

/** Routes the SDK's HTTP call to `handler`; returns the calls it made. */
function stubElevenLabs(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = { url: new URL(href), headers: new Headers(init?.headers), method: init?.method ?? "GET" };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

describe("deleteConversation", () => {
  it("sends DELETE for the id with the key in a header", async () => {
    const calls = stubElevenLabs(() => new Response(null, { status: 200 }));

    expect(await deleteConversation("conv_1")).toBe("deleted");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.pathname).toBe("/v1/convai/conversations/conv_1");
    expect(calls[0].headers.get("xi-api-key")).toBe(API_KEY);
  });

  it("treats a conversation the platform no longer has as done, so a retry is harmless", async () => {
    stubElevenLabs(() =>
      Response.json({ detail: { type: "not_found", code: "conversation_not_found", message: "x" } }, { status: 404 }),
    );
    expect(await deleteConversation("conv_gone")).toBe("not-found");
  });

  it("reports other failures in the app's taxonomy", async () => {
    stubElevenLabs(() => Response.json({ detail: "x" }, { status: 503 }));
    await expect(deleteConversation("conv_1")).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
  });
});

/** The platform's record, in the API's own casing. */
const record = (overrides: Record<string, unknown> = {}) => ({
  agent_id: "agent_1",
  conversation_id: "conv_1",
  status: "done",
  transcript: [
    { role: "agent", message: "Hi Ana.", time_in_call_secs: 0, interrupted: false },
    { role: "user", message: "Hello.", time_in_call_secs: 3 },
    { role: "agent", message: null, time_in_call_secs: 9 },
  ],
  metadata: { start_time_unix_secs: 1_760_000_000, call_duration_secs: 200.4, termination_reason: "end_call tool" },
  conversation_initiation_client_data: { dynamic_variables: { interview_id: "int_1", system__time: "x" } },
  has_audio: false,
  has_user_audio: false,
  has_response_audio: false,
  has_auxiliary_audio: false,
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv("ELEVENLABS_API_KEY", API_KEY);
});

describe("fetchConversation", () => {
  it("fetches by id with the key in a header and maps an ended conversation to the webhook's shape", async () => {
    const calls = stubElevenLabs(() => Response.json(record()));

    const fetched = await fetchConversation("conv_1");

    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/v1/convai/conversations/conv_1");
    expect(calls[0].headers.get("xi-api-key")).toBe(API_KEY);
    expect(fetched).toEqual({
      kind: "ended",
      data: {
        agent_id: "agent_1",
        conversation_id: "conv_1",
        status: "done",
        transcript: [
          { role: "agent", message: "Hi Ana.", time_in_call_secs: 0 },
          { role: "user", message: "Hello.", time_in_call_secs: 3 },
          { role: "agent", message: null, time_in_call_secs: 9 },
        ],
        metadata: { start_time_unix_secs: 1_760_000_000, call_duration_secs: 200.4, termination_reason: "end_call tool" },
        conversation_initiation_client_data: { dynamic_variables: { interview_id: "int_1", system__time: "x" } },
      },
    });
  });

  it.each(["initiated", "in-progress", "processing"])("reports a %s conversation as still in progress", async (status) => {
    stubElevenLabs(() => Response.json(record({ status })));
    expect(await fetchConversation("conv_1")).toEqual({ kind: "in-progress", platformStatus: status });
  });

  it("reports a conversation the platform does not have as not found", async () => {
    stubElevenLabs(() => Response.json({ detail: "not found" }, { status: 404 }));
    expect(await fetchConversation("conv_gone")).toEqual({ kind: "not-found" });
  });

  it.each([
    { status: 503, code: "VOICE_UNAVAILABLE" },
    { status: 401, code: "VOICE_MISCONFIGURED" },
  ])("throws the app's voice error on HTTP $status", async ({ status, code }) => {
    stubElevenLabs(() => Response.json({ detail: "x" }, { status }));
    await expect(fetchConversation("conv_1")).rejects.toMatchObject({ code });
  });

  it("refuses to call out without a key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const calls = stubElevenLabs(() => Response.json(record()));
    await expect(fetchConversation("conv_1")).rejects.toMatchObject({ code: "VOICE_MISCONFIGURED" });
    expect(calls).toHaveLength(0);
  });
});

/** What `GET /v1/user/subscription` answers, in the API's casing. */
const subscription = (overrides: Record<string, unknown> = {}) => ({
  tier: "creator",
  status: "active",
  character_count: 50_000,
  character_limit: 121_000,
  max_credit_limit_extension: 0,
  can_extend_character_limit: false,
  allowed_to_extend_character_limit: false,
  next_character_count_reset_unix: 1_764_547_200,
  voice_slots_used: 0,
  professional_voice_slots_used: 0,
  professional_voice_slots_used_in_workspace: 0,
  voice_limit: 10,
  voice_add_edit_counter: 0,
  professional_voice_limit: 1,
  can_extend_voice_limit: false,
  can_use_instant_voice_cloning: true,
  can_use_professional_voice_cloning: true,
  current_overage: { amount: "0", currency: "usd" },
  open_invoices: [],
  has_open_invoices: false,
  ...overrides,
});

/** The refusal the owner's key produced on 2026-10-23, verbatim in shape. */
const missingUserRead = () =>
  Response.json(
    {
      detail: {
        type: "authentication_error",
        code: "unauthorized",
        message: "The API key you used is missing the permission user_read to execute this operation.",
        status: "missing_permissions",
        request_id: "cfa400bb0dd5652e3c0c0eef14f44620",
      },
    },
    { status: 401 },
  );

describe("readVoiceBalance", () => {
  it("reads the subscription with the key and reduces it to the balance", async () => {
    const calls = stubElevenLabs(() => Response.json(subscription()));

    const read = await readVoiceBalance();

    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/v1/user/subscription");
    expect(calls[0].headers.get("xi-api-key")).toBe(API_KEY);
    expect(read).toEqual({
      kind: "balance",
      balance: {
        tier: "creator",
        status: "active",
        creditsUsed: 50_000,
        creditsLimit: 121_000,
        creditsRemaining: 71_000,
        extension: 0,
        resetsAt: new Date(1_764_547_200 * 1000),
      },
    });
  });

  it("never reports a negative remainder, keeps an unlimited extension, and tolerates a missing reset", async () => {
    stubElevenLabs(() => Response.json(subscription({ character_count: 130_000, max_credit_limit_extension: "unlimited", next_character_count_reset_unix: undefined })));
    const read = await readVoiceBalance();
    expect(read).toMatchObject({ kind: "balance", balance: { creditsRemaining: 0, extension: "unlimited", resetsAt: null } });
  });

  it("reports a key without user_read as such, naming the permission, instead of as an outage", async () => {
    stubElevenLabs(missingUserRead);
    expect(await readVoiceBalance()).toEqual({ kind: "no-permission", permission: "user_read" });
  });

  it.each([
    { status: 503, code: "VOICE_UNAVAILABLE" },
    { status: 401, code: "VOICE_MISCONFIGURED" },
  ])("throws the app's voice error on any other HTTP $status", async ({ status, code }) => {
    stubElevenLabs(() => Response.json({ detail: "x" }, { status }));
    await expect(readVoiceBalance()).rejects.toMatchObject({ code });
  });

  it("refuses to call out without a key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const calls = stubElevenLabs(() => Response.json(subscription()));
    await expect(readVoiceBalance()).rejects.toMatchObject({ code: "VOICE_MISCONFIGURED" });
    expect(calls).toHaveLength(0);
  });
});

describe("missingPermission", () => {
  it("names the permission only for a missing_permissions refusal", () => {
    expect(missingPermission(new Error("x"))).toBeNull();
    expect(missingPermission({ statusCode: 401 })).toBeNull();
  });
});
