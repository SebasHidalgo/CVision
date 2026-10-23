import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signClerkWebhook } from "@/lib/clerk/webhookSignature";
import { upsertUserById } from "@/lib/database/userById";
import { deleteAccountCascade } from "@/lib/deletion";
import { POST } from "./route";

vi.mock("@/lib/database/userById", () => ({ upsertUserById: vi.fn(async () => {}) }));
vi.mock("@/lib/deletion", () => ({ deleteAccountCascade: vi.fn() }));

const deleted = (userRowRemoved: boolean) => ({
  analyses: userRowRemoved ? 2 : 0,
  leftoverObjects: 0,
  leftoverObjectsRemoved: true,
  conversationsFailed: 0,
  subscriptionsCanceled: 0,
  subscriptionsFailed: 0,
  userRowRemoved,
});

// A Svix-style secret: whsec_ plus base64 key material.
const SECRET = `whsec_${Buffer.from("clerk-test-signing-key-0123456789").toString("base64")}`;

const userCreated = (id = "user_9") =>
  JSON.stringify({ type: "user.created", object: "event", data: { id, object: "user", email_addresses: [] } });
const userDeleted = (id?: string) =>
  JSON.stringify({ type: "user.deleted", object: "event", data: { id, object: "user", deleted: true } });

async function deliver(body: string, headers: Record<string, string>) {
  const response = await POST(
    new NextRequest("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
  return response.status;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SECRET);
  vi.mocked(deleteAccountCascade).mockResolvedValue(deleted(true));
  for (const method of ["info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

describe("POST /api/webhooks/clerk: verification", () => {
  it("accepts a delivery signed with the signing secret", async () => {
    const body = userCreated();
    expect(await deliver(body, signClerkWebhook(body, SECRET))).toBe(200);
    expect(upsertUserById).toHaveBeenCalledWith("user_9");
  });

  it("answers 400 to a bad signature, an altered body, or missing headers, and writes nothing", async () => {
    const body = userCreated();
    expect(await deliver(body, signClerkWebhook(body, `whsec_${Buffer.from("another-key").toString("base64")}`))).toBe(400);
    expect(await deliver(body.replace("user_9", "user_8"), signClerkWebhook(body, SECRET))).toBe(400);
    expect(await deliver(body, {})).toBe(400);
    expect(upsertUserById).not.toHaveBeenCalled();
  });

  it("answers 400 to a signature older than the tolerance", async () => {
    const body = userCreated();
    const headers = signClerkWebhook(body, SECRET, { timestampSeconds: Math.floor(Date.now() / 1000) - 10 * 60 });
    expect(await deliver(body, headers)).toBe(400);
  });

  it("answers 500 when the secret is not configured, so Clerk retries after the fix", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    const body = userCreated();
    expect(await deliver(body, signClerkWebhook(body, SECRET))).toBe(500);
  });
});

describe("POST /api/webhooks/clerk: events", () => {
  it("user.deleted runs the account cascade, and a retry for an account already gone still answers 200", async () => {
    const body = userDeleted("user_9");
    expect(await deliver(body, signClerkWebhook(body, SECRET))).toBe(200);
    expect(deleteAccountCascade).toHaveBeenCalledWith("user_9");

    vi.mocked(deleteAccountCascade).mockResolvedValue(deleted(false));
    expect(await deliver(body, signClerkWebhook(body, SECRET, { id: "msg_retry" }))).toBe(200);
  });

  it("acknowledges a user.deleted without an id, and any other event type, without writing", async () => {
    const noId = userDeleted(undefined);
    expect(await deliver(noId, signClerkWebhook(noId, SECRET))).toBe(200);

    const other = JSON.stringify({ type: "session.created", object: "event", data: { id: "sess_1", user_id: "user_9" } });
    expect(await deliver(other, signClerkWebhook(other, SECRET))).toBe(200);
    expect(deleteAccountCascade).not.toHaveBeenCalled();
    expect(upsertUserById).not.toHaveBeenCalled();
  });

  it("answers 500 when the write fails, so Clerk retries", async () => {
    vi.mocked(upsertUserById).mockRejectedValue(new Error("db down"));
    const body = userCreated();
    expect(await deliver(body, signClerkWebhook(body, SECRET))).toBe(500);
  });
});
