import type { CaseKind, CaseStatus } from "@/screens/Home/utils/exampleCase";
import type { ScoreTone } from "@/lib/score";

export type KindCount = { total: number; met: number; partial: number; notShown: number };
export type CaseTally = Record<CaseKind, KindCount>;

type Countable = { readonly kind: CaseKind; readonly status: CaseStatus };

/** The example's counts, kept like the app's requirementTally: what a CV can't show sits beside the count. */
export function caseTally(requirements: readonly Countable[]): CaseTally {
  const count = (kind: CaseKind): KindCount => {
    const all = requirements.filter((r) => r.kind === kind);
    const judged = all.filter((r) => r.status !== "notshown");
    return {
      total: judged.length,
      met: judged.filter((r) => r.status === "met").length,
      partial: judged.filter((r) => r.status === "partial").length,
      notShown: all.length - judged.length,
    };
  };
  return { required: count("required"), preferred: count("preferred") };
}

/** deriveFitVerdict's rule on those counts; tally.test.ts holds the two together on every combination. */
export function caseVerdict({ required, preferred }: CaseTally): ScoreTone {
  if (required.total + required.notShown === 0) return "weak";
  const cleared = required.total - required.met - required.partial === 0 && required.partial <= 1;
  if (!cleared) return "weak";
  return preferred.met + 0.5 * preferred.partial >= 2 ? "strong" : "fair";
}
