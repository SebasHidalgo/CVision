import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileUsers, type ReconcileReport } from "@/lib/accountReconcile";
import { ClerkLookupError } from "@/lib/clerk/users";
import { GET } from "./route";

vi.mock("@/lib/accountReconcile", () => ({ reconcileUsers: vi.fn() }));

const SECRET = "cron-secret-0123456789abcdef";

const report = (overrides: Partial<ReconcileReport> = {}): ReconcileReport => ({
  mode: "apply",
  checked: 40,
  skippedRecent: 2,
  candidates: 1,
  listMismatches: 0,
  limit: 8,
  limitSource: "default",
  outcome: "done",
  gone: [{ id: "user_gone", createdAt: new Date("2026-10-01T00:00:00Z") }],
  deleted: ["user_gone"],
  deferred: [],
  failed: null,
  ...overrides,
});

async function get(authorization?: string) {
  const response = await GET(new Request("http://localhost/api/cron/users-reconcile", { headers: authorization ? { authorization } : {} }));
  return { status: response.status, body: (await response.json()) as { ok: boolean; code?: string; data?: unknown } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.mocked(reconcileUsers).mockResolvedValue(report());
  for (const method of ["info", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

describe("GET /api/cron/users-reconcile", () => {
  it("applies the reconcile with a deadline for the bearer Vercel sends, and answers counts only", async () => {
    const before = Date.now();
    const { status, body } = await get(`Bearer ${SECRET}`);

    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: { outcome: "done", checked: 40, skippedRecent: 2, candidates: 1, listMismatches: 0, limit: 8, gone: 1, deleted: 1, deferred: 0, failed: 0 },
    });
    const [options] = vi.mocked(reconcileUsers).mock.calls[0];
    expect(options.apply).toBe(true);
    expect(options.maxDelete).toBeUndefined();
    expect(options.deadline).toBeGreaterThanOrEqual(before + 30_000);
    expect(options.deadline).toBeLessThanOrEqual(Date.now() + 50_000);
    expect(JSON.stringify(body)).not.toContain("user_gone");
  });

  it("refuses a missing or wrong bearer without touching anything", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("Bearer nope")).status).toBe(401);
    expect((await get(SECRET)).status).toBe(401);
    expect(reconcileUsers).not.toHaveBeenCalled();
  });

  it("refuses everything, loudly, when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(await get(`Bearer ${SECRET}`)).toEqual({ status: 500, body: { ok: false, code: "CRON_MISCONFIGURED" } });
    expect(reconcileUsers).not.toHaveBeenCalled();
  });

  it("answers 500 and logs loudly when the blast-radius guard refuses", async () => {
    vi.mocked(reconcileUsers).mockResolvedValue(report({ outcome: "refused", candidates: 40, gone: [], deleted: [] }));
    const { status, body } = await get(`Bearer ${SECRET}`);
    expect(status).toBe(500);
    expect(body.code).toBe("RECONCILE_REFUSED");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("REFUSED by the blast-radius guard"));
  });

  it("answers 500 when a deletion failed, and when Clerk could not be read", async () => {
    vi.mocked(reconcileUsers).mockResolvedValue(report({ outcome: "partial", deleted: [], failed: "user_gone" }));
    expect((await get(`Bearer ${SECRET}`)).body.code).toBe("RECONCILE_FAILED");

    vi.mocked(reconcileUsers).mockRejectedValue(new ClerkLookupError("list: HTTP 503"));
    expect(await get(`Bearer ${SECRET}`)).toEqual({ status: 500, body: { ok: false, code: "RECONCILE_FAILED" } });
  });

  it("answers 200 when the deadline left accounts for the next run", async () => {
    vi.mocked(reconcileUsers).mockResolvedValue(report({ outcome: "partial", gone: report().gone, deleted: [], deferred: ["user_gone"] }));
    const { status, body } = await get(`Bearer ${SECRET}`);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ deferred: 1, deleted: 0 });
  });
});
