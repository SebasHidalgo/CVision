import { ANSWERED_GAPS, REQUIREMENTS, type RequirementId } from "@/screens/Home/utils/exampleCase";

// The story's steps and the few facts its figure derives from the example case. Ids and numbers only: every
// visible string is in locales/<lang>/landingStory.json.

/** The section's anchor, the same in every language: the header's "How it works" link points at `#how-it-works`. */
export const STORY_ANCHOR = "how-it-works";

export const STEP_IDS =["posting", "requirements", "search", "verdict", "interview", "feedback"] as const;
export type StepId = (typeof STEP_IDS)[number];

export type AnsweredGapId = (typeof ANSWERED_GAPS)[number]["req"];

/** How the example interview went on each gap it took up (the landing case's `case.outcome.*`). */
export const GAP_OUTCOMES = { r3: "addressed", r5: "partly" } as const satisfies Record<AnsweredGapId, "addressed" | "partly">;

/** Two digits, as the step counter and the CV line numbers print them. */
export const pad2 = (n: number) => String(n).padStart(2, "0");

/** Seconds into the call as m:ss. */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

type Count = { met: number; partial: number; total: number };

/** The example's verdict arithmetic, counted the way the analysis page counts it: "not shown" is outside both totals. */
export function exampleTally() {
  const count = (kind: "required" | "preferred"): Count => {
    const rows = REQUIREMENTS.filter((r) => r.kind === kind && r.status !== "notshown");
    return {
      met: rows.filter((r) => r.status === "met").length,
      partial: rows.filter((r) => r.status === "partial").length,
      total: rows.length,
    };
  };
  return {
    required: count("required"),
    preferred: count("preferred"),
    notShown: REQUIREMENTS.filter((r) => r.status === "notshown").length,
  };
}

/** The requirements a CV line proves (met or partly met), each with that line: the search step's wires and highlights. */
export const PROOFS: readonly { id: RequirementId; line: number; partial: boolean }[] = REQUIREMENTS.flatMap((r) =>
  r.line !== null && (r.status === "met" || r.status === "partial") ? [{ id: r.id, line: r.line, partial: r.status === "partial" }] : [],
);
