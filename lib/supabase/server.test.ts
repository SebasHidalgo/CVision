import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSignedReadUrl,
  objectExists,
  removeObject,
  SIGNED_READ_TTL_SECONDS,
  uploadObject,
} from "./server";

const URL_BASE = "https://project.supabase.test";
const KEY = "cv/user_1/11111111-2222-4333-8444-555555555555.pdf";

type Call = { url: string; method: string; headers: Headers; body: unknown };

/** Routes the SDK's HTTP calls to `handler`; returns what it sent. */
function stubStorage(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_BASE);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createSignedReadUrl", () => {
  it("asks the sign endpoint with the service role and returns a signed URL, never a public one", async () => {
    const calls = stubStorage(() =>
      json({ signedURL: `/object/sign/files-bucket/${KEY}?token=tok_abc` }),
    );

    const url = await createSignedReadUrl(KEY);

    expect(url).toBe(`${URL_BASE}/storage/v1/object/sign/files-bucket/${KEY}?token=tok_abc`);
    expect(url).not.toContain("/object/public/");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${URL_BASE}/storage/v1/object/sign/files-bucket/${KEY}`);
    expect(calls[0].body).toEqual({ expiresIn: SIGNED_READ_TTL_SECONDS });
    expect(calls[0].headers.get("authorization")).toBe("Bearer service-role-test-key");
  });

  it("lasts ten minutes by default", () => {
    expect(SIGNED_READ_TTL_SECONDS).toBe(600);
  });

  it("answers null for an object that is not there", async () => {
    stubStorage(() => json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400));

    expect(await createSignedReadUrl(KEY)).toBeNull();
  });

  it("reports storage trouble as STORAGE_UNAVAILABLE without the key in the message", async () => {
    stubStorage(() => json({ statusCode: "500", error: "x", message: "boom" }, 500));

    await expect(createSignedReadUrl(KEY)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      message: expect.not.stringContaining("user_1"),
    });
  });

  it("refuses to run without the service role, before any request", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const calls = stubStorage(() => json({}));

    await expect(createSignedReadUrl(KEY)).rejects.toMatchObject({ code: "STORAGE_MISCONFIGURED" });
    expect(calls).toHaveLength(0);
  });
});

describe("uploadObject, objectExists, removeObject", () => {
  it("uploads as a PDF without overwriting", async () => {
    const calls = stubStorage(() => json({ Key: `files-bucket/${KEY}` }));

    await uploadObject(KEY, new Uint8Array([0x25, 0x50, 0x44, 0x46]));

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${URL_BASE}/storage/v1/object/files-bucket/${KEY}`);
    expect(calls[0].headers.get("x-upsert")).toBe("false");
    expect(calls[0].headers.get("content-type")).toBe("application/pdf");
  });

  it("answers whether an object exists from a HEAD", async () => {
    const calls = stubStorage(() => new Response(null, { status: 200 }));
    expect(await objectExists(KEY)).toBe(true);
    expect(calls[0].method).toBe("HEAD");

    stubStorage(() => new Response(null, { status: 404 }));
    expect(await objectExists(KEY)).toBe(false);
  });

  it("never throws from a remove: it runs from a catch", async () => {
    stubStorage(() => json({ statusCode: "500", error: "x", message: "boom" }, 500));
    await expect(removeObject(KEY)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
