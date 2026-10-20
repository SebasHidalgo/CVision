import { after } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import { storeConversationTranscript } from "@/lib/database/interviewTranscript";
import { signWebhookPayload } from "@/lib/elevenlabs/webhookSignature";
import { POST } from "./route";

vi.mock("@/lib/database/interviewTranscript", () => ({ storeConversationTranscript: vi.fn() }));
vi.mock("@/lib/ai/interviewFeedback", () => ({ generateInterviewFeedback: vi.fn() }));
// after() needs a request scope Next provides at runtime; here it runs the
// task at once so the test can see what was scheduled.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn((task: () => unknown) => void task()) };
});

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
  vi.mocked(generateInterviewFeedback).mockResolvedValue({ kind: "completed", feedbackId: "fb_1" });
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

describe("POST /api/webhooks/elevenlabs: feedback trigger", () => {
  it("schedules feedback generation after the response when a scoreable transcript was stored", async () => {
    const { raw, signature } = signed(event());

    expect(await deliver(raw, signature)).toBe(200);
    expect(after).toHaveBeenCalledTimes(1);
    expect(generateInterviewFeedback).toHaveBeenCalledWith("int_1");
  });

  it("does not generate for a transcript with no candidate turns, a duplicate, or an unmatched one", async () => {
    for (const result of [
      { outcome: "stored" as const, interviewId: "int_1", status: "IN_PROGRESS" },
      { outcome: "duplicate" as const, interviewId: "int_1" },
      { outcome: "unmatched" as const },
    ]) {
      vi.mocked(storeConversationTranscript).mockResolvedValueOnce(result);
      const { raw, signature } = signed(event());
      expect(await deliver(raw, signature)).toBe(200);
    }
    expect(generateInterviewFeedback).not.toHaveBeenCalled();
  });

  it("still answers 200 when the scheduled generation throws", async () => {
    vi.mocked(generateInterviewFeedback).mockRejectedValue(new Error("db down"));
    const { raw, signature } = signed(event());

    expect(await deliver(raw, signature)).toBe(200);
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

  it("answers 500 when the write fails, so the platform retries", async () => {
    vi.mocked(storeConversationTranscript).mockRejectedValue(new Error("db down"));
    const { raw, signature } = signed(event());

    expect(await deliver(raw, signature)).toBe(500);
  });
});
