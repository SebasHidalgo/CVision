import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectOrphans } from "@/lib/supabase/gc";
import { GET } from "./route";

vi.mock("@/lib/supabase/gc", () => ({ collectOrphans: vi.fn() }));

const SECRET = "cron-secret-0123456789abcdef";

async function get(authorization?: string) {
  const response = await GET(new Request("http://localhost/api/cron/storage-gc", { headers: authorization ? { authorization } : {} }));
  return { status: response.status, body: (await response.json()) as unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.mocked(collectOrphans).mockResolvedValue({
    referencedKeys: 4,
    objects: 6,
    classified: [],
    orphans: [{ key: "cv/user_x/a.pdf", size: 100, createdAt: null, verdict: { kind: "orphan", why: "no-row" } }],
    orphanBytes: 100,
    missing: [],
    deleted: 1,
    after: [],
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/cron/storage-gc", () => {
  it("runs the collector with deletion for the bearer Vercel sends, and answers counts only", async () => {
    expect(await get(`Bearer ${SECRET}`)).toEqual({
      status: 200,
      body: { ok: true, data: { referencedKeys: 4, objects: 6, orphans: 1, orphanBytes: 100, deleted: 1, missing: 0, left: 0 } },
    });
    expect(collectOrphans).toHaveBeenCalledWith({ remove: true });
    const logged = String(vi.mocked(console.info).mock.calls[0][0]);
    expect(logged).not.toContain("cv/user_x");
  });

  it("refuses a missing or wrong bearer without touching the bucket", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("Bearer nope")).status).toBe(401);
    expect((await get(SECRET)).status).toBe(401);
    expect(collectOrphans).not.toHaveBeenCalled();
  });

  it("refuses everything, loudly, when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(await get(`Bearer ${SECRET}`)).toEqual({ status: 500, body: { ok: false, code: "CRON_MISCONFIGURED" } });
    expect(collectOrphans).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("CRON_SECRET is not set"));
  });

  it("answers 500 when the collector throws, so the run shows as failed in Vercel's logs", async () => {
    vi.mocked(collectOrphans).mockRejectedValue(new Error("storage down"));
    expect((await get(`Bearer ${SECRET}`)).status).toBe(500);
  });
});
