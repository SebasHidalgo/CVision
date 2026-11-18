import type { MarkStatus } from "@/components/design-system/StatusMark";

// The landing's example: a Full Stack posting at Orilla Software (invented) read against Guillermo Hidalgo's invented
// CV. Structure only; every visible string is under `case.*` in locales/<lang>/landing.json.

export type CaseStatus = MarkStatus;
export type CaseKind = "required" | "preferred";
export type CvLineKind = "name" | "meta" | "head" | "role" | "text";

export const TERM_IDS = ["react", "typescript", "node", "postgres", "mysql", "aws"] as const;
export type TermId = (typeof TERM_IDS)[number];

/** A requirement's key terms: groups of alternatives ("PostgreSQL or MySQL"), each found in the CV or not. */
export type TermGroup = readonly { readonly id: TermId; readonly found: boolean }[];

export const REQUIREMENT_IDS = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;
export type RequirementId = (typeof REQUIREMENT_IDS)[number];

export type CaseRequirement = {
  readonly id: RequirementId;
  /** Shown as R1…R6. */
  readonly n: string;
  readonly kind: CaseKind;
  readonly status: CaseStatus;
  /** The CV line that proves it (1-based), or null. */
  readonly line: number | null;
  readonly terms?: readonly TermGroup[];
};

export const REQUIREMENTS: readonly CaseRequirement[] = [
  { id: "r1", n: "R1", kind: "required", status: "met", line: 4 },
  { id: "r2", n: "R2", kind: "required", status: "met", line: 6, terms: [[{ id: "react", found: true }], [{ id: "typescript", found: true }]] },
  {
    id: "r3",
    n: "R3",
    kind: "required",
    status: "partial",
    line: 7,
    terms: [
      [{ id: "node", found: true }],
      [
        { id: "postgres", found: false },
        { id: "mysql", found: false },
      ],
    ],
  },
  { id: "r4", n: "R4", kind: "required", status: "notshown", line: null },
  { id: "r5", n: "R5", kind: "preferred", status: "missing", line: null, terms: [[{ id: "aws", found: false }]] },
  { id: "r6", n: "R6", kind: "preferred", status: "met", line: 11 },
];

export const CV_LINE_IDS = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10", "l11"] as const;
export type CvLineId = (typeof CV_LINE_IDS)[number];

export const CV_LINES: readonly { readonly n: number; readonly id: CvLineId; readonly kind: CvLineKind }[] = [
  { n: 1, id: "l1", kind: "name" },
  { n: 2, id: "l2", kind: "meta" },
  { n: 3, id: "l3", kind: "head" },
  { n: 4, id: "l4", kind: "role" },
  { n: 5, id: "l5", kind: "text" },
  { n: 6, id: "l6", kind: "text" },
  { n: 7, id: "l7", kind: "text" },
  { n: 8, id: "l8", kind: "role" },
  { n: 9, id: "l9", kind: "text" },
  // The last two sections set inline, as compact CVs do: 11 rows keep the 3D sheet readable at 1280x720.
  { n: 10, id: "l10", kind: "text" },
  { n: 11, id: "l11", kind: "text" },
];

/** The two weak points the example interview took up, and when the answer was said in the call (seconds). */
export const ANSWERED_GAPS = [
  { req: "r3", at: 58 },
  { req: "r5", at: 81 },
] as const satisfies readonly { req: RequirementId; at: number }[];
