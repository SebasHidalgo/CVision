import { describe, expect, it, vi } from "vitest";
import { reportInterviewEnded, requestInterviewSession } from "./session";

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

const SESSION = {
  connectionType: "webrtc",
  conversationToken: "tok_1",
  conversationId: "conv_1",
  dynamicVariables: { interview_id: INTERVIEW_ID, candidate_name: "Ana" },
  language: "es",
  expiresAt: "2026-10-12T10:15:00.000Z",
  maxDurationSeconds: 720,
};

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => Response.json(body, { status }));

describe("requestInterviewSession", () => {
  it("posts to the session endpoint and returns the parsed session on 2xx", async () => {
    const fetchImpl = respond({ ok: true, data: SESSION });

    const result = await requestInterviewSession(INTERVIEW_ID, fetchImpl);

    expect(result).toEqual({ ok: true, data: SESSION });
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/interview/${INTERVIEW_ID}/session`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses the body's code when a non-2xx carries the project's shape", async () => {
    expect(
      await requestInterviewSession(INTERVIEW_ID, respond({ ok: false, code: "INTERVIEW_START_LIMIT" }, 409)),
    ).toEqual({ ok: false, code: "INTERVIEW_START_LIMIT" });
    expect(
      await requestInterviewSession(INTERVIEW_ID, respond({ ok: false, code: "NOT_FOUND" }, 404)),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("treats a non-JSON 404 (the signed-out middleware page) as a failed request, not a code", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<!doctype html><title>Not found</title>", { status: 404, headers: { "content-type": "text/html" } }),
    );

    expect(await requestInterviewSession(INTERVIEW_ID, fetchImpl)).toEqual({ ok: false, code: "REQUEST_FAILED" });
  });

  it("treats a 2xx whose body is not a session as a failed request", async () => {
    expect(await requestInterviewSession(INTERVIEW_ID, respond({ ok: true, data: { token: "x" } }))).toEqual({
      ok: false,
      code: "REQUEST_FAILED",
    });
    expect(
      await requestInterviewSession(INTERVIEW_ID, respond({ ok: true, data: { ...SESSION, connectionType: "websocket" } })),
    ).toEqual({ ok: false, code: "REQUEST_FAILED" });
    expect(await requestInterviewSession(INTERVIEW_ID, respond("ok"))).toEqual({ ok: false, code: "REQUEST_FAILED" });
  });

  it("reports a thrown fetch as REQUEST_FAILED", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await requestInterviewSession(INTERVIEW_ID, fetchImpl)).toEqual({ ok: false, code: "REQUEST_FAILED" });
  });
});

describe("reportInterviewEnded", () => {
  it("posts the reason to the ended endpoint with keepalive, so it outlives the navigation", async () => {
    const fetchImpl = respond({ ok: true, data: { recorded: true } });

    await reportInterviewEnded(INTERVIEW_ID, "agent", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/interview/${INTERVIEW_ID}/ended`,
      expect.objectContaining({ method: "POST", keepalive: true, body: JSON.stringify({ reason: "agent" }) }),
    );
  });

  it("swallows every failure: a rejected fetch and a non-2xx alike", async () => {
    await expect(
      reportInterviewEnded(INTERVIEW_ID, "error", vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })),
    ).resolves.toBeUndefined();
    await expect(
      reportInterviewEnded(INTERVIEW_ID, "error", respond({ ok: false, code: "UNAUTHORIZED" }, 401)),
    ).resolves.toBeUndefined();
  });
});
