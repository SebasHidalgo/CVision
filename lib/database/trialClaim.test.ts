import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import type { PlanStanding } from "@/lib/billing/access";
import { MIN_PEPPER_CHARS, trialIdentityOf, type TrialIdentity } from "@/lib/trialClaim";
import { trialIdentityFor } from "@/lib/trialIdentity";
import { resolvePlanStanding, resolvePlanStandingIn } from "./billing";
import { deleteUserRows } from "./userById";
import { refundUsage, reserveInterview, resolveInterviewEntitlement, usageSummary } from "./usage";

/**
 * One free trial per email, end to end through the ledger, on an in-memory
 * database: the reservation claims the account's verified emails, a refund
 * frees them, deleting the account (its rows cascade) leaves them, and a new
 * account of the same inbox, or a variant of it, gets no trial.
 */

type Event = { id: string; userId: string; kind: string; refId: string; units: number; createdAt: Date; refundedAt: Date | null; refundReason: string | null; trialClaimHashes: string[] };

const store = vi.hoisted(() => ({
  events: [] as Event[],
  claims: new Map<string, Date>(),
  emails: new Map<string, string[]>(),
  /** Runs right before a claim insert: a concurrent account's claim lands here. */
  beforeClaimInsert: null as null | (() => void),
}));

const PEPPER = "t".repeat(MIN_PEPPER_CHARS);
const NOW = new Date("2026-11-19T12:00:00Z");

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(), getOptionalUserIdOutsideProxy: vi.fn() }));
vi.mock("./interviewExpiry", () => ({ expireAbandonedInterviews: vi.fn(async () => 0) }));
vi.mock("@/lib/billing/reconcile", () => ({ reconcileIfStale: vi.fn(async () => false) }));
vi.mock("./billing", () => ({
  resolvePlanStanding: vi.fn(),
  resolvePlanStandingIn: vi.fn(),
  findBillingCustomer: vi.fn(async () => null),
  listSubscriptionRows: vi.fn(async () => []),
  transactionApplied: vi.fn(async () => false),
}));
vi.mock("@/lib/trialIdentity", () => ({ trialIdentityFor: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const conflict = () => new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test", meta: { modelName: "TrialClaim", target: ["emailHash"] } });
  const live = (event: Event) => event.refundedAt === null;
  const grouped = (rows: Event[]) => {
    const kinds = [...new Set(rows.map((row) => row.kind))];
    return kinds.map((kind) => {
      const of = rows.filter((row) => row.kind === kind);
      return { kind, _count: { _all: of.length }, _sum: { units: of.reduce((sum, row) => sum + row.units, 0) } };
    });
  };
  const db = {
    usageEvent: {
      groupBy: vi.fn(async ({ where }: { where: { userId: string; OR?: unknown; createdAt?: { gte: Date; lt: Date } } }) => {
        const mine = store.events.filter((row) => row.userId === where.userId);
        if (where.OR) {
          return grouped(mine.filter((row) => row.kind.startsWith("INTERVIEW_CREDIT_") || (["INTERVIEW_CREDIT", "INTERVIEW", "INTERVIEW_TRIAL"].includes(row.kind) && live(row))));
        }
        const range = where.createdAt!;
        return grouped(mine.filter((row) => live(row) && ["ANALYSIS", "INTERVIEW"].includes(row.kind) && row.createdAt >= range.gte && row.createdAt < range.lt));
      }),
      count: vi.fn(async ({ where }: { where: { kind: string; refId: { startsWith: string } } }) =>
        store.events.filter((row) => row.kind === where.kind && row.refId.startsWith(where.refId.startsWith) && row.refundedAt !== null).length,
      ),
      create: vi.fn(async ({ data }: { data: Omit<Event, "id" | "units" | "refundedAt" | "refundReason" | "trialClaimHashes"> & { trialClaimHashes?: string[] } }) => {
        if (data.kind === "INTERVIEW_TRIAL" && store.events.some((row) => row.userId === data.userId && row.kind === "INTERVIEW_TRIAL" && live(row))) {
          throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test", meta: { modelName: "UsageEvent", target: ["userId"] } });
        }
        const event: Event = { id: `evt_${store.events.length + 1}`, units: 1, refundedAt: null, refundReason: null, trialClaimHashes: [], ...data };
        store.events.push(event);
        return { id: event.id };
      }),
      updateManyAndReturn: vi.fn(async ({ where, data }: { where: { id: string }; data: { refundedAt: Date; refundReason: string } }) => {
        const event = store.events.find((row) => row.id === where.id && live(row));
        if (!event) return [];
        Object.assign(event, data);
        return [{ kind: event.kind, trialClaimHashes: event.trialClaimHashes }];
      }),
    },
    interview: { count: vi.fn(async () => 0) },
    trialClaim: {
      findFirst: vi.fn(async ({ where }: { where: { emailHash: { in: string[] } } }) => {
        const hash = where.emailHash.in.find((h) => store.claims.has(h));
        return hash ? { emailHash: hash } : null;
      }),
      createMany: vi.fn(async ({ data }: { data: { emailHash: string; createdAt: Date }[] }) => {
        store.beforeClaimInsert?.();
        if (data.some((row) => store.claims.has(row.emailHash))) throw conflict();
        for (const row of data) store.claims.set(row.emailHash, row.createdAt);
        return { count: data.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { emailHash: { in: string[] } } }) => {
        let count = 0;
        for (const hash of where.emailHash.in) if (store.claims.delete(hash)) count += 1;
        return { count };
      }),
    },
    user: {
      // The FK cascade: an account's ledger rows go with it. TrialClaim has no FK, so nothing here touches it.
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        const before = store.events.length;
        store.events = store.events.filter((row) => row.userId !== where.id);
        return { count: before === store.events.length ? 0 : 1 };
      }),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => unknown) => run(db));
  return { default: db };
});

const FREE: PlanStanding = { plan: "FREE", source: "free", subscription: null, everSubscribed: false };
const PRO: PlanStanding = { plan: "PRO", source: "comp", subscription: null, everSubscribed: false };

function account(userId: string, ...emails: string[]) {
  store.emails.set(userId, emails);
}

beforeEach(() => {
  vi.clearAllMocks();
  store.events = [];
  store.claims.clear();
  store.emails.clear();
  store.beforeClaimInsert = null;
  vi.mocked(resolvePlanStanding).mockResolvedValue(FREE);
  vi.mocked(resolvePlanStandingIn).mockResolvedValue(FREE);
  vi.mocked(trialIdentityFor).mockImplementation(async (userId: string) => trialIdentityOf(store.emails.get(userId) ?? [], PEPPER));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const trialRows = (userId: string) => store.events.filter((row) => row.userId === userId && row.kind === "INTERVIEW_TRIAL");

describe("one free trial per email", () => {
  it("a deleted account's email signing up again gets no trial: the claim outlives the account's rows", async () => {
    account("user_a", "ana@example.com");
    expect(await reserveInterview("user_a", "int_a", NOW)).toMatchObject({ kind: "INTERVIEW_TRIAL", source: "trial" });
    expect(store.claims.size).toBe(1);
    expect(trialRows("user_a")[0].trialClaimHashes).toEqual([...store.claims.keys()]);

    expect(await deleteUserRows("user_a")).toBe(true);
    expect(store.events).toEqual([]);
    expect(store.claims.size).toBe(1);

    account("user_b", "ana@example.com");
    expect(await resolveInterviewEntitlement("user_b", NOW)).toMatchObject({ source: "none", reason: "trial-claimed", remaining: { trial: 0 } });
    await expect(reserveInterview("user_b", "int_b", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });
    expect(trialRows("user_b")).toEqual([]);
    expect((await usageSummary("user_b", NOW)).trial).toEqual({ available: false, used: false, blocked: "claimed" });
  });

  it("a subaddress or a Gmail-dot variant of the same inbox gets no trial", async () => {
    account("user_a", "Ana.Perez@gmail.com");
    await reserveInterview("user_a", "int_a", NOW);

    for (const [id, email] of [
      ["user_b", "anaperez+jobs@gmail.com"],
      ["user_c", "a.n.a.p.e.r.e.z@googlemail.com"],
    ]) {
      account(id, email);
      expect(await resolveInterviewEntitlement(id, NOW), email).toMatchObject({ source: "none", reason: "trial-claimed" });
    }
  });

  it("checks every verified email of the account, not only the primary", async () => {
    account("user_a", "old@example.com");
    await reserveInterview("user_a", "int_a", NOW);

    account("user_b", "new@example.com", "old+x@example.com");
    expect(await resolveInterviewEntitlement("user_b", NOW)).toMatchObject({ source: "none", reason: "trial-claimed" });
  });

  it("claims every verified email when the trial is spent", async () => {
    account("user_a", "one@example.com", "two@example.com");
    await reserveInterview("user_a", "int_a", NOW);
    expect(store.claims.size).toBe(2);

    account("user_b", "two@example.com");
    expect(await resolveInterviewEntitlement("user_b", NOW)).toMatchObject({ reason: "trial-claimed" });
  });

  it("a refund (silent, lost or failed call, abandonment) frees the claim: the email's trial is available again", async () => {
    account("user_a", "ana@example.com");
    const { eventId } = await reserveInterview("user_a", "int_a", NOW);

    expect(await refundUsage(eventId, "NO_CANDIDATE_TURNS")).toBe(true);
    expect(store.claims.size).toBe(0);
    expect(await resolveInterviewEntitlement("user_a", NOW)).toMatchObject({ source: "trial" });

    account("user_b", "ana@example.com");
    expect(await resolveInterviewEntitlement("user_b", NOW)).toMatchObject({ source: "trial", reason: "trial-available" });
    // A second refund of the same unit changes nothing, and frees nothing a later reservation wrote.
    await reserveInterview("user_b", "int_b", NOW);
    expect(await refundUsage(eventId, "NO_CANDIDATE_TURNS")).toBe(false);
    expect(store.claims.size).toBe(1);
  });

  it("a new email gets its trial", async () => {
    account("user_a", "ana@example.com");
    await reserveInterview("user_a", "int_a", NOW);

    account("user_b", "bruno@example.com");
    expect(await reserveInterview("user_b", "int_b", NOW)).toMatchObject({ kind: "INTERVIEW_TRIAL", tier: "TRIAL" });
  });

  it("an email claimed between the read and the insert is the quota refusal, never a crash, and writes nothing", async () => {
    account("user_b", "ana@example.com");
    const theirs = trialIdentityOf(["ana@example.com"], PEPPER) as Extract<TrialIdentity, { kind: "emails" }>;
    store.beforeClaimInsert = () => store.claims.set(theirs.hashes[0], NOW);

    await expect(reserveInterview("user_b", "int_b", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED", meta: { plan: "FREE" } });
    expect(trialRows("user_b")).toEqual([]);
  });

  it("reads the emails outside the transaction, only when the trial is open: a second pass writes", async () => {
    account("user_a", "ana@example.com");
    await reserveInterview("user_a", "int_a", NOW);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(vi.mocked(trialIdentityFor).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]);
    expect(vi.mocked(trialIdentityFor).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(prisma.$transaction).mock.invocationCallOrder[1]);
  });

  it("a Pro start, a start on a credit after the trial, or an account that had voice never reads the emails", async () => {
    vi.mocked(resolvePlanStanding).mockResolvedValue(PRO);
    vi.mocked(resolvePlanStandingIn).mockResolvedValue(PRO);
    account("user_p", "ana@example.com");
    expect(await reserveInterview("user_p", "int_p", NOW)).toMatchObject({ kind: "INTERVIEW", source: "period" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    vi.mocked(resolvePlanStanding).mockResolvedValue({ ...FREE, everSubscribed: true });
    vi.mocked(resolvePlanStandingIn).mockResolvedValue({ ...FREE, everSubscribed: true });
    expect(await resolveInterviewEntitlement("user_p", NOW)).toMatchObject({ source: "none", reason: "had-voice" });
    expect(trialIdentityFor).not.toHaveBeenCalled();
  });

  it("a claimed email with a pack credit still starts, on the credit", async () => {
    account("user_a", "ana@example.com");
    await reserveInterview("user_a", "int_a", NOW);
    account("user_b", "ana@example.com");
    store.events.push({ id: "grant", userId: "user_b", kind: "INTERVIEW_CREDIT_GRANT", refId: "txn_1", units: 4, createdAt: NOW, refundedAt: null, refundReason: null, trialClaimHashes: [] });

    // The account page still says why there is no trial behind the credits.
    expect((await usageSummary("user_b", NOW)).trial).toEqual({ available: false, used: false, blocked: "claimed" });
    vi.mocked(trialIdentityFor).mockClear();
    expect(await reserveInterview("user_b", "int_b", NOW)).toMatchObject({ kind: "INTERVIEW_CREDIT", source: "credit" });
    // A start the credit pays for never reads the emails.
    expect(trialIdentityFor).not.toHaveBeenCalled();
  });

  it("fails closed when the emails cannot be checked: no trial, its own reason, and nothing claimed", async () => {
    vi.mocked(trialIdentityFor).mockResolvedValue({ kind: "unavailable", cause: "no-pepper" });
    account("user_a", "ana@example.com");

    expect(await resolveInterviewEntitlement("user_a", NOW)).toMatchObject({ source: "none", reason: "trial-unavailable" });
    await expect(reserveInterview("user_a", "int_a", NOW)).rejects.toMatchObject({ code: "INTERVIEW_QUOTA_EXCEEDED" });
    expect(store.claims.size).toBe(0);
  });
});

describe("the deletion cascade never removes a claim", () => {
  const schema = readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

  it("TrialClaim has no relation: no field of it, and no field anywhere, points between it and an account", () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "TrialClaim");
    expect(model?.fields.map((field) => field.name).sort()).toEqual(["createdAt", "emailHash"]);
    expect(model?.fields.every((field) => field.kind === "scalar")).toBe(true);
    const pointing = Prisma.dmmf.datamodel.models.flatMap((m) => m.fields.filter((field) => field.type === "TrialClaim").map((field) => `${m.name}.${field.name}`));
    expect(pointing).toEqual([]);
    expect(schema).toMatch(/model TrialClaim \{/);
  });

  it("no step of the account deletion (lib/deletion.ts and the rows it deletes) names the table", () => {
    for (const file of ["lib/deletion.ts", "lib/database/deletion.ts", "lib/database/userById.ts", "lib/accountReconcile.ts"]) {
      expect(readFileSync(path.resolve(process.cwd(), file), "utf8"), file).not.toMatch(/trialClaim/i);
    }
  });

  it("no migration adds a foreign key to TrialClaim", () => {
    const dir = path.resolve(process.cwd(), "prisma/migrations");
    const sql = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return readFileSync(path.join(dir, entry.name, "migration.sql"), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    expect(sql).toContain('CREATE TABLE "TrialClaim"');
    expect(sql).not.toMatch(/ALTER TABLE "TrialClaim"[^;]*FOREIGN KEY/i);
    expect(sql).not.toMatch(/REFERENCES "TrialClaim"/i);
  });
});
