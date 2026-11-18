import { describe, expect, it } from "vitest";
import type { RequirementKind, RequirementStatus } from "@/lib/schemas/resumeSchema";
import { groupRequirements, orderRequirements, shownKind } from "./requirementOrder";

type Row = { id: string; kind?: RequirementKind; status: RequirementStatus };

const row = (id: string, kind: RequirementKind | undefined, status: RequirementStatus): Row => ({ id, kind, status });
const ids = (rows: readonly Row[]) => rows.map((r) => r.id);

describe("orderRequirements", () => {
  it("puts required before preferred, and inside each met, partly met, not met", () => {
    const rows = [
      row("p-missing", "preferred", "missing"),
      row("r-missing", "required", "missing"),
      row("p-met", "preferred", "met"),
      row("r-partial", "required", "partial"),
      row("p-partial", "preferred", "partial"),
      row("r-met", "required", "met"),
    ];

    expect(ids(orderRequirements(rows))).toEqual(["r-met", "r-partial", "r-missing", "p-met", "p-partial", "p-missing"]);
  });

  it("puts what a CV can't show last, after both kinds, whatever its kind", () => {
    const rows = [
      row("r-hidden", "required", "not_evident"),
      row("p-missing", "preferred", "missing"),
      row("p-hidden", "preferred", "not_evident"),
      row("r-missing", "required", "missing"),
    ];

    expect(ids(orderRequirements(rows))).toEqual(["r-missing", "p-missing", "r-hidden", "p-hidden"]);
  });

  it("keeps the posting's order between rows of the same group and status", () => {
    const rows = [
      row("a", "required", "met"),
      row("b", "required", "missing"),
      row("c", "required", "met"),
      row("d", "preferred", "not_evident"),
      row("e", "required", "missing"),
      row("f", "required", "not_evident"),
      row("g", "required", "met"),
    ];

    expect(ids(orderRequirements(rows))).toEqual(["a", "c", "g", "b", "e", "d", "f"]);
  });

  it("reads a row without a kind as required", () => {
    const rows = [row("p-met", "preferred", "met"), row("old-missing", undefined, "missing"), row("old-met", undefined, "met")];

    expect(ids(orderRequirements(rows))).toEqual(["old-met", "old-missing", "p-met"]);
    expect(shownKind({})).toBe("required");
    expect(shownKind({ kind: "preferred" })).toBe("preferred");
    expect(shownKind({ kind: "required" })).toBe("required");
  });

  it("keeps a list of only not-shown rows in the posting's order", () => {
    const rows = [row("a", "preferred", "not_evident"), row("b", "required", "not_evident"), row("c", undefined, "not_evident")];

    expect(ids(orderRequirements(rows))).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for an empty list", () => {
    expect(orderRequirements([])).toEqual([]);
  });

  it("returns a new array and leaves the stored one as it was", () => {
    const rows = Object.freeze([row("p", "preferred", "met"), row("r", "required", "missing")]);
    const before = JSON.stringify(rows);

    const ordered = orderRequirements(rows);

    expect(ordered).not.toBe(rows);
    expect(JSON.stringify(rows)).toBe(before);
    expect(ordered[0]).toBe(rows[1]);
  });
});

describe("groupRequirements", () => {
  it("gives the three groups in page order, each in its order, and drops empty ones", () => {
    const rows = [
      row("p-missing", "preferred", "missing"),
      row("r-hidden", "required", "not_evident"),
      row("r-met", "required", "met"),
      row("p-met", "preferred", "met"),
    ];

    expect(groupRequirements(rows).map((group) => [group.id, ids(group.rows)])).toEqual([
      ["required", ["r-met"]],
      ["preferred", ["p-met", "p-missing"]],
      ["notShown", ["r-hidden"]],
    ]);
    expect(groupRequirements([row("p", "preferred", "partial")]).map((group) => group.id)).toEqual(["preferred"]);
    expect(groupRequirements([row("x", "required", "not_evident")]).map((group) => group.id)).toEqual(["notShown"]);
    expect(groupRequirements([])).toEqual([]);
  });
});
