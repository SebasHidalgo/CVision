import { beforeEach, describe, expect, it, vi } from "vitest";
import { storeConversationTranscript } from "@/lib/database/interviewTranscript";
import { signWebhookPayload } from "@/lib/elevenlabs/webhookSignature";
import { POST } from "./route";

vi.mock("@/lib/database/interviewTranscript", () => ({ storeConversationTranscript: vi.fn() }));

const SECRET = "whsec_test_0123456789";
const NOW = Math.floor(Date.now() / 1000);

const event = (overrides: Record<string, unknown> = {}) => ({
  type: "post_call_transcription",
  event_timestamp: NOW,
  data: {
    agent_id: "agent_1",
    conversation_id: "conv_1",
    status: "done",
    transcript: [
      { role: "agent", message: "Hi Ana.", time_in_call_secs: 0 },
      { role: "user", message: "Hello.", time_in_call_secs: 3 },
    ],
    metadata: { start_time_unix_secs: NOW - 400, call_duration_secs: 380 },
    conversation_initiation_client_data: { dynamic_variables: { interview_id: "int_1" } },
    ...overrides,
  },
});

async function deliver(rawBody: string, signature: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["ElevenLabs-Signature"] = signature;

  const response = await POST(
    new Request("http://localhost/api/webhooks/elevenlabs", { method: "POST", headers, body: rawBody }),
  );
  return response.status;
}

const signed = (body: unknown) => {
  const raw = JSON.stringify(body);
  return { raw, signature: signWebhookPayload(raw, SECRET) };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", SECRET);
  vi.mocked(storeConversationTranscript).mockResolvedValue({
    outcome: "stored",
    interviewId: "int_1",
    status: "FEEDBACK_PENDING",
  });
  for (const method of ["info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

describe("POST /api/webhooks/elevenlabs: verification", () => {
  it("accepts a delivery signed with the shared secret and stores it", async () => {
    const { raw, signature } = signed(event());

    expect(await deliver(raw, signature)).toBe(200);
    expect(storeConversationTranscript).toHaveBeenCalledTimes(1);
    const [{ data, eventTimestamp }] = vi.mocked(storeConversationTranscript).mock.calls[0];
    expect(data.conversation_id).toBe("conv_1");
    expect(data.transcript).toHaveLength(2);
    expect(eventTimestamp).toBe(NOW);
  });

  it("rejects a body altered after signing", async () => {
    const { raw, signature } = signed(event());

    expect(await deliver(raw.replace('"Hello."', '"Hello!"'), signature)).toBe(401);
    expect(storeConversationTranscript).not.toHaveBeenCalled();
  });

  it("rejects a signature made with another secret", async () => {
    const raw = JSON.stringify(event());

    expect(await deliver(raw, signWebhookPayload(raw, "whsec_other"))).toBe(401);
    expect(storeConversationTranscript).not.toHaveBeenCalled();
  });

  it("rejects a missing header", async () => {
    expect(await deliver(JSON.stringify(event()), null)).toBe(401);
    expect(storeConversationTranscript).not.toHaveBeenCalled();
  });

  it("rejects a signature older than the tolerance window", async () => {
    const raw = JSON.stringify(event());

    expect(await deliver(raw, signWebhookPayload(raw, SECRET, NOW - 31 * 60))).toBe(401);
    expect(storeConversationTranscript).not.toHaveBeenCalled();
  });

  it("answers 500 when the secret is not configured, so the platform retries after the fix", async () => {
    vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", "");
    const { raw, signature } = signed(event());

    expect(await deliver(raw, signature)).toBe(500);
    expect(storeConversationTranscript).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/elevenlabs: routing and dead ends", () => {
  it("acknowledges other event types without storing", async () => {
    const { raw, signature } = signed({ type: "post_call_audio", event_timestamp: NOW, data: { conversation_id: "conv_1", full_audio: "" } });

    expect(await deliver(raw, signature)).toBe(200);
    expect(storeConversationTranscript).not.toHaveBeenCalled();
  });

  it("acknowledges a transcription payload outside the expected shape without storing", async () => {
    const { raw, signature } = signed(event({ conversation_id: undefined }));

    expect(await deliver(raw, signature)).toBe(200);
    expect(storeConversationTranscript).not.toHaveBeenCalled();
  });

  it("acknowledges an unmatched conversation and a duplicate delivery with 200", async () => {
    vi.mocked(storeConversationTranscript).mockResolvedValueOnce({ outcome: "unmatched" });
    const first = signed(event());
    expect(await deliver(first.raw, first.signature)).toBe(200);

    vi.mocked(storeConversationTranscript).mockResolvedValueOnce({ outcome: "duplicate", interviewId: "int_1" });
    const replay = signed(event());
    expect(await deliver(replay.raw, replay.signature)).toBe(200);
  });

  it("answers 500 when the write fails, so the platform retries", async () => {
    vi.mocked(storeConversationTranscript).mockRejectedValue(new Error("db down"));
    const { raw, signature } = signed(event());

    expect(await deliver(raw, signature)).toBe(500);
  });
});
