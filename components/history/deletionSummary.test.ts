import { describe, expect, it } from "vitest";
import { deletionSummary } from "./deletionSummary";

describe("deletionSummary", () => {
  it("says what went, then why the rest didn't, and that nothing changed when nothing did", () => {
    expect(deletionSummary({ deleted: 3, busy: 0, failed: 0, remaining: 0 })).toEqual([{ kind: "deleted", count: 3 }]);
    expect(deletionSummary({ deleted: 2, busy: 1, failed: 1, remaining: 4 })).toEqual([
      { kind: "deleted", count: 2 },
      { kind: "busy", count: 1 },
      { kind: "failed", count: 1 },
      { kind: "remaining", count: 4 },
    ]);
    expect(deletionSummary({ deleted: 0, busy: 0, failed: 0, remaining: 0 })).toEqual([{ kind: "unchanged" }]);
  });
});
