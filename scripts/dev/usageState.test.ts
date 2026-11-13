import { describe, expect, it, vi } from "vitest";
import type { PlanStanding } from "@/lib/billing/access";
import { DEV_RESET_PREFIX, DEV_RESET_REASON, resetDevTrial } from "./usageState";

const NOW = new Date("2026-11-13T12:00:00Z");
const standing = (plan: "FREE" | "PRO", everSubscribed = false) => ({ plan, source: plan === "PRO" ? "comp" : "free", subscription: null, everSubscribed }) as unknown as PlanStanding;

type Held = { id: string; usageEventId: string | null; paidBy: "TRIAL" | "PERIOD" | "CREDIT" | null };

/** A database of one account: its live trial rows, the interviews that hold a unit, and the ledger ids that still exist. */
function fakeDb({ liveTrials = 1, held = [] as Held[], existing = [] as string[], fullEver = 0, credits = 0 }) {
  const usageEvent = {
    updateMany: vi.fn(async () => ({ count: liveTrials })),
    findMany: vi.fn(async () => existing.map((id) => ({ id }))),
    create: vi.fn(async () => ({ id: "audit" })),
    count: vi.fn(async ({ where }: { where: { kind: unknown } }) => (typeof where.kind === "string" ? 0 : fullEver)),
    groupBy: vi.fn(async () => (credits > 0 ? [{ kind: "INTERVIEW_CREDIT_GRANT", _sum: { units: credits } }] : [])),
  };
  const interview = { findMany: vi.fn(async () => held), updateMany: vi.fn(async () => ({ count: held.length })) };
  const db = { usageEvent, interview, user: {}, $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run({ usageEvent, interview })) };
  return { db: db as never, usageEvent, interview };
}

describe("dev:usage --reset-trial", () => {
  it("gives every live trial unit back as a marked refund, never a deletion, and leaves an audit row that counts for nothing", async () => {
    const { db, usageEvent } = fakeDb({ liveTrials: 1 });

    const report = await resetDevTrial(db, "user_1", async () => standing("FREE"), NOW);

    expect(usageEvent.updateMany).toHaveBeenCalledWith({ where: { userId: "user_1", kind: "INTERVIEW_TRIAL", refundedAt: null }, data: { refundedAt: NOW, refundReason: DEV_RESET_REASON } });
    const audit = (usageEvent.create.mock.calls as unknown as [[{ data: { refId: string; refundedAt: Date; refundReason: string; kind: string } }]])[0][0];
    expect(audit.data).toMatchObject({ userId: "user_1", kind: "INTERVIEW_TRIAL", refundedAt: NOW, refundReason: DEV_RESET_REASON });
    expect(audit.data.refId.startsWith(DEV_RESET_PREFIX)).toBe(true);
    expect(report).toMatchObject({ trialsReset: 1, interviewsReleased: 0, dangling: 0 });
    expect(report.entitlement).toMatchObject({ source: "trial", maxDurationSeconds: 300 });
    expect(report.notes).toEqual([]);
  });

  it("releases an unfinished interview that holds the trial unit, so its next start reserves again instead of running unpaid", async () => {
    const { db, interview } = fakeDb({ held: [{ id: "int_live", usageEventId: "evt_trial", paidBy: "TRIAL" }], existing: ["evt_trial"] });

    const report = await resetDevTrial(db, "user_1", async () => standing("FREE"), NOW);

    expect(interview.findMany).toHaveBeenCalledWith({ where: { userId: "user_1", usageEventId: { not: null }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } }, select: { id: true, usageEventId: true, paidBy: true } });
    expect(interview.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["int_live"] } }, data: { usageEventId: null } });
    expect(report).toMatchObject({ interviewsReleased: 1, dangling: 0 });
  });

  it("repairs what a hand-deleted ledger row leaves: an unfinished interview still marked as paid by a unit that no longer exists", async () => {
    const { db, interview } = fakeDb({
      liveTrials: 0,
      held: [
        { id: "int_dangling", usageEventId: "evt_deleted", paidBy: "TRIAL" },
        { id: "int_credit", usageEventId: "evt_credit", paidBy: "CREDIT" },
      ],
      existing: ["evt_credit"],
    });

    const report = await resetDevTrial(db, "user_1", async () => standing("FREE"), NOW);

    // The interview paid by a credit that exists keeps its unit.
    expect(interview.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["int_dangling"] } }, data: { usageEventId: null } });
    expect(report).toMatchObject({ trialsReset: 0, interviewsReleased: 1, dangling: 1 });
    expect(report.notes[0]).toContain("deleted by hand");
  });

  it("says why the trial is still not what the next start gets, and undoes none of it", async () => {
    const pro = await resetDevTrial(fakeDb({}).db, "user_1", async () => standing("PRO"), NOW);
    expect(pro.entitlement.source).toBe("period");
    expect(pro.notes.join(" ")).toContain("--plan free");

    const subscribedOnce = await resetDevTrial(fakeDb({}).db, "user_1", async () => standing("FREE", true), NOW);
    expect(subscribedOnce.entitlement.source).toBe("none");
    expect(subscribedOnce.notes.join(" ")).toContain("had a subscription once");

    const hadFull = await resetDevTrial(fakeDb({ fullEver: 1 }).db, "user_1", async () => standing("FREE"), NOW);
    expect(hadFull.notes.join(" ")).toContain("ran a full interview");

    const credits = await resetDevTrial(fakeDb({ credits: 2 }).db, "user_1", async () => standing("FREE"), NOW);
    expect(credits.entitlement.source).toBe("credit");
    expect(credits.notes.join(" ")).toContain("pack credits");
  });
});
