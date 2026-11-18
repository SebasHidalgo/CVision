import { describe, expect, it } from "vitest";
import { REQUIREMENTS, type CaseKind, type CaseStatus } from "@/screens/Home/utils/exampleCase";
import { deriveFitVerdict, requirementTally, type ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import { caseTally, caseVerdict } from "./tally";

type Row = { kind: CaseKind; status: CaseStatus };

// The app's functions read only jobFit.requirements' kind and status.
const asFeedback = (rows: readonly Row[]) =>
  ({
    jobFit: { requirements: rows.map((r) => ({ kind: r.kind, status: r.status === "notshown" ? "not_evident" : r.status })) },
  }) as unknown as ResumeAnalysisFeedback;

const STATUSES: CaseStatus[] = ["met", "partial", "missing", "notshown"];

function* combinations(slots: number): Generator<CaseStatus[]> {
  if (slots === 0) {
    yield [];
    return;
  }
  for (const status of STATUSES) for (const rest of combinations(slots - 1)) yield [status, ...rest];
}

describe("the example's verdict", () => {
  it("counts the example the way the app counts an analysis", () => {
    expect(caseTally(REQUIREMENTS)).toEqual(requirementTally(asFeedback(REQUIREMENTS)));
  });

  it("is a partial fit: every required item met or one partial, one preferred met", () => {
    expect(caseVerdict(caseTally(REQUIREMENTS))).toBe("fair");
  });

  it("agrees with deriveFitVerdict on every mix of up to three required and three preferred items", () => {
    const disagreements: string[] = [];
    for (let required = 0; required <= 3; required++) {
      for (let preferred = 0; preferred <= 3; preferred++) {
        for (const statuses of combinations(required + preferred)) {
          const rows: Row[] = statuses.map((status, i) => ({ kind: i < required ? "required" : "preferred", status }));
          const app = deriveFitVerdict(asFeedback(rows)).tone;
          const ours = caseVerdict(caseTally(rows));
          if (app !== ours) disagreements.push(`${JSON.stringify(rows)}: app ${app}, landing ${ours}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });
});
