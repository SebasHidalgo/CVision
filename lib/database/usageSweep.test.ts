import { beforeEach, describe, expect, it, vi } from "vitest";
import { ABANDONED_ANALYSIS_MS, refundAbandonedAnalyses, refundUsage, settleAnalysisUnit } from "./usage";

/**
 * The abandoned-unit sweep and the settle, against an in-memory ledger that applies the same conditional `where`
 * clauses Postgres would: the races between a late request and the sweep are played out in both orders, and with
 * one interleaved between the sweep's read and its write.
 */

type Unit = { id: string; userId: string; kind: string; refId: string; createdAt: Date; refundedAt: Date | null; refundReason: string | null; settledAt: Date | null };

const db = vi.hoisted(() => ({ units: [] as Unit[], analyses: new Set<string>(), beforeAnalysisRead: null as null | (() => Promise<void>) }));

type Where = Record<string, unknown>;
const matches = (row: Record<string, unknown>, where: Where) =>
  Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition === null) return value === null;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (typeof condition === "object") {
      const c = condition as { in?: unknown[]; lt?: Date };
      if (c.in) return c.in.includes(value);
      if (c.lt) return value instanceof Date && value.getTime() < c.lt.getTime();
    }
    return value === condition;
  });
const pick = (row: Record<string, unknown>, select: Record<string, boolean>) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));

vi.mock("@/lib/prisma", () => {
  const update = (where: Where, data: Partial<Unit>) => {
    const hit = db.units.filter((unit) => matches(unit, where));
    for (const unit of hit) Object.assign(unit, data);
    return hit;
  };
  return {
    default: {
      usageEvent: {
        findMany: vi.fn(async ({ where, select, take }: { where: Where; select: Record<string, boolean>; take?: number }) =>
          db.units
            .filter((unit) => matches(unit, where))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .slice(0, take ?? Infinity)
            .map((unit) => pick(unit, select)),
        ),
        updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Unit> }) => ({ count: update(where, data).length })),
        updateManyAndReturn: vi.fn(async ({ where, data, select }: { where: Where; data: Partial<Unit>; select: Record<string, boolean> }) =>
          update(where, data).map((unit) => pick(unit, select)),
        ),
      },
      resumeAnalysis: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          // A request acting between the sweep's read of the ledger and its write.
          await db.beforeAnalysisRead?.();
          return where.id.in.filter((id) => db.analyses.has(id)).map((id) => ({ id }));
        }),
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(), getOptionalUserIdOutsideProxy: vi.fn() }));
vi.mock("./interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn() }));
vi.mock("./billing", () => ({ resolvePlanStanding: vi.fn(), resolvePlanStandingIn: vi.fn(), findBillingCustomer: vi.fn(), transactionApplied: vi.fn(), listSubscriptionRows: vi.fn() }));
vi.mock("@/lib/billing/reconcile", () => ({ reconcileIfStale: vi.fn() }));

const NOW = new Date("2026-11-19T04:17:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ANALYSIS = "0b7e2d14-3f9a-8c61-8e05-7d2c9a4b1f63";
const OTHER = "9f0c4a52-6c1e-8e7a-9d3b-2a5f8e1c7b40";

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: "evt_1",
  userId: "user_1",
  kind: "ANALYSIS",
  refId: ANALYSIS,
  createdAt: ago(2 * ABANDONED_ANALYSIS_MS),
  refundedAt: null,
  refundReason: null,
  settledAt: null,
  ...overrides,
});
const byId = (id: string) => db.units.find((one) => one.id === id)!;

beforeEach(() => {
  db.units = [];
  db.analyses = new Set();
  db.beforeAnalysisRead = null;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("refundAbandonedAnalyses: the units whose request died", () => {
  it("gives back a held unit with no analysis row, older than the threshold, with one log line of ids", async () => {
    db.units = [unit()];

    expect(await refundAbandonedAnalyses(NOW)).toEqual({ examined: 1, refunded: 1, settled: 0 });
    expect(byId("evt_1")).toMatchObject({ refundedAt: NOW, refundReason: "ABANDONED_REQUEST", settledAt: null });
    expect(console.info).toHaveBeenCalledExactlyOnceWith(`[CVision][usage] abandoned analysis unit refunded: event=evt_1 user=user_1 ref=${ANALYSIS} age=120min`);
  });

  it("gives back a later unit of the same submission by its <id>#<n> reference", async () => {
    db.units = [unit({ id: "evt_2", refId: `${ANALYSIS}#2` })];
    expect((await refundAbandonedAnalyses(NOW)).refunded).toBe(1);
  });

  it("never touches a unit a live request may hold, a settled one (its analysis deleted since) or a refunded one", async () => {
    db.units = [
      unit({ id: "young", createdAt: ago(ABANDONED_ANALYSIS_MS - 1_000) }),
      unit({ id: "deleted", refId: OTHER, settledAt: ago(2 * ABANDONED_ANALYSIS_MS - 9_000) }),
      unit({ id: "refunded", refundedAt: ago(1_000), refundReason: "AI_UNAVAILABLE" }),
    ];

    expect(await refundAbandonedAnalyses(NOW)).toEqual({ examined: 0, refunded: 0, settled: 0 });
    expect(byId("young").refundedAt).toBeNull();
    expect(byId("deleted").refundedAt).toBeNull();
    expect(byId("refunded").refundReason).toBe("AI_UNAVAILABLE");
  });

  it("marks a held unit whose analysis row exists as spent, never refunded (a row saved by a deploy that did not settle yet)", async () => {
    db.units = [unit()];
    db.analyses.add(ANALYSIS);

    expect(await refundAbandonedAnalyses(NOW)).toEqual({ examined: 1, refunded: 0, settled: 1 });
    expect(byId("evt_1")).toMatchObject({ refundedAt: null, settledAt: NOW });
  });

  it("skips a reference that is not an analysis id, and only analysis units are read", async () => {
    db.units = [unit({ id: "dev", refId: "dev-usage:ANALYSIS:x" }), unit({ id: "interview", kind: "INTERVIEW" })];

    expect(await refundAbandonedAnalyses(NOW)).toEqual({ examined: 1, refunded: 0, settled: 0 });
    expect(byId("dev").refundedAt).toBeNull();
    expect(byId("interview").refundedAt).toBeNull();
  });

  it("takes at most the limit a run, the oldest first; the next run takes the rest", async () => {
    db.units = [unit({ id: "b", refId: OTHER, createdAt: ago(3 * ABANDONED_ANALYSIS_MS) }), unit({ id: "a", createdAt: ago(4 * ABANDONED_ANALYSIS_MS) })];

    expect((await refundAbandonedAnalyses(NOW, { limit: 1 })).refunded).toBe(1);
    expect(byId("a").refundedAt).toEqual(NOW);
    expect(byId("b").refundedAt).toBeNull();
    expect((await refundAbandonedAnalyses(NOW, { limit: 1 })).refunded).toBe(1);
    expect(byId("b").refundedAt).toEqual(NOW);
  });

  it("a second run changes nothing", async () => {
    db.units = [unit()];
    await refundAbandonedAnalyses(NOW);
    expect(await refundAbandonedAnalyses(NOW)).toEqual({ examined: 0, refunded: 0, settled: 0 });
  });
});

describe("the sweep against a late request: never charged twice, never given back wrongly", () => {
  it("sweep first, then the request comes back: its settle fails, so it saves nothing under the returned unit", async () => {
    db.units = [unit()];

    await refundAbandonedAnalyses(NOW);
    expect(await settleAnalysisUnit("evt_1", NOW)).toBe(false);
    // The request's own refund afterwards is a no-op: the unit was returned once.
    expect(await refundUsage("evt_1", "UNKNOWN")).toBe(false);
    expect(byId("evt_1")).toMatchObject({ refundedAt: NOW, refundReason: "ABANDONED_REQUEST", settledAt: null });
  });

  it("the request first (settled, its row saved), then the sweep: the unit stays spent", async () => {
    db.units = [unit()];

    expect(await settleAnalysisUnit("evt_1", NOW)).toBe(true);
    db.analyses.add(ANALYSIS);
    expect(await refundAbandonedAnalyses(NOW)).toEqual({ examined: 0, refunded: 0, settled: 0 });
    expect(byId("evt_1")).toMatchObject({ refundedAt: null, settledAt: NOW });
  });

  it("the request settles between the sweep's read and its write: the sweep's conditional refund misses it", async () => {
    db.units = [unit()];
    db.beforeAnalysisRead = async () => {
      expect(await settleAnalysisUnit("evt_1", NOW)).toBe(true);
    };

    expect(await refundAbandonedAnalyses(NOW)).toEqual({ examined: 1, refunded: 0, settled: 0 });
    expect(byId("evt_1")).toMatchObject({ refundedAt: null, settledAt: NOW });
  });

  it("a settled unit whose insert then failed is still refunded by its request, once", async () => {
    db.units = [unit({ createdAt: ago(5_000) })];

    expect(await settleAnalysisUnit("evt_1", NOW)).toBe(true);
    expect(await refundUsage("evt_1", "UNKNOWN")).toBe(true);
    expect(await refundUsage("evt_1", "UNKNOWN")).toBe(false);
    expect(byId("evt_1").refundReason).toBe("UNKNOWN");
  });

  it("settles only an analysis unit, and only once", async () => {
    db.units = [unit(), unit({ id: "trial", kind: "INTERVIEW_TRIAL", refId: OTHER })];
    expect(await settleAnalysisUnit("trial", NOW)).toBe(false);
    expect(await settleAnalysisUnit("evt_1", NOW)).toBe(true);
    expect(await settleAnalysisUnit("evt_1", NOW)).toBe(false);
  });
});
