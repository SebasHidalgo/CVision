import { describe, expect, it, vi } from "vitest";
import { GUARD_ROWS, type GuardStats } from "@/lib/ai/schemas";
import { guardStatDay, guardStatIncrements, recordGuardStatsDaily } from "./guardStats";

const GUARD_ROWS_CHECK = GUARD_ROWS.check;
const GUARD_ROWS_RECORDED = GUARD_ROWS.recorded;
const GUARD_ROWS_FIRED = GUARD_ROWS.fired;

const fired: GuardStats = {
  counts: { "quote-dropped": 2, "item-dropped": 1, recorded: 0 },
  interventions: [
    { check: "evidence-grounding", action: "quote-dropped", path: "a", value: "the candidate's words" },
    { check: "evidence-grounding", action: "quote-dropped", path: "b", value: "more of them" },
    { check: "anchor-invalid", action: "item-dropped", path: "c", value: "notableAnswers[3]" },
  ],
};

const clean: GuardStats = { counts: { "quote-dropped": 0, recorded: 0 }, interventions: [] };

describe("guardStatIncrements", () => {
  it("tallies interventions per (check, action) and counts the row as recorded and fired", () => {
    expect(guardStatIncrements(fired)).toEqual([
      { check: "evidence-grounding", action: "quote-dropped", count: 2 },
      { check: "anchor-invalid", action: "item-dropped", count: 1 },
      { check: GUARD_ROWS_CHECK, action: GUARD_ROWS_RECORDED, count: 1 },
      { check: GUARD_ROWS_CHECK, action: GUARD_ROWS_FIRED, count: 1 },
    ]);
  });

  it("counts a clean row as recorded only", () => {
    expect(guardStatIncrements(clean)).toEqual([{ check: GUARD_ROWS_CHECK, action: GUARD_ROWS_RECORDED, count: 1 }]);
  });

  it("carries no value, path or user: the aggregate is anonymous by construction", () => {
    for (const increment of guardStatIncrements(fired)) {
      expect(Object.keys(increment).sort()).toEqual(["action", "check", "count"]);
    }
  });
});

describe("guardStatDay", () => {
  it("is the UTC day, so a row stored at 23:30 in the Americas lands on the UTC date", () => {
    expect(guardStatDay(new Date("2026-10-20T05:30:00Z"))).toEqual(new Date("2026-10-20T00:00:00Z"));
    expect(guardStatDay(new Date("2026-10-20T23:59:59.999Z"))).toEqual(new Date("2026-10-20T00:00:00Z"));
  });
});

describe("recordGuardStatsDaily", () => {
  it("upserts one increment per tally through the caller's transaction client", async () => {
    const tx = { guardStatDaily: { upsert: vi.fn(async () => ({})) } };

    await recordGuardStatsDaily(tx as never, "ANALYSIS", new Date("2026-10-20T15:00:00Z"), fired);

    expect(tx.guardStatDaily.upsert).toHaveBeenCalledTimes(4);
    expect(tx.guardStatDaily.upsert).toHaveBeenCalledWith({
      where: {
        date_kind_check_action: {
          date: new Date("2026-10-20T00:00:00Z"),
          kind: "ANALYSIS",
          check: "evidence-grounding",
          action: "quote-dropped",
        },
      },
      create: { date: new Date("2026-10-20T00:00:00Z"), kind: "ANALYSIS", check: "evidence-grounding", action: "quote-dropped", count: 2 },
      update: { count: { increment: 2 } },
    });
  });
});
