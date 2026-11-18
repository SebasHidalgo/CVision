import type { RequirementKind, RequirementStatus } from "@/lib/schemas/resumeSchema";

/**
 * The page's order of the requirements: required, then preferred; inside each, met, partly met, not met; what a CV
 * can't show last, in a group of its own whatever its kind; ties keep the posting's order. Presentation only: the
 * stored array and the verdict never change.
 */

type Orderable = { kind?: RequirementKind; status: RequirementStatus };

export type RequirementGroupId = "required" | "preferred" | "notShown";

const GROUPS: readonly RequirementGroupId[] = ["required", "preferred", "notShown"];

const STATUS_RANK: Record<RequirementStatus, number> = { met: 0, partial: 1, missing: 2, not_evident: 3 };

/**
 * The kind a row is shown as. A row stored without one reads as required: the schema has always asked for a kind,
 * and a gap is safer shown with the bar than hidden among the extras.
 */
export function shownKind({ kind }: { kind?: RequirementKind }): RequirementKind {
  return kind === "preferred" ? "preferred" : "required";
}

function groupOf(requirement: Orderable): RequirementGroupId {
  return requirement.status === "not_evident" ? "notShown" : shownKind(requirement);
}

/** A new array in the page's order; the input is left as it was. */
export function orderRequirements<T extends Orderable>(requirements: readonly T[]): T[] {
  return requirements
    .map((requirement, index) => ({ requirement, index, group: GROUPS.indexOf(groupOf(requirement)) }))
    .sort((a, b) => a.group - b.group || STATUS_RANK[a.requirement.status] - STATUS_RANK[b.requirement.status] || a.index - b.index)
    .map(({ requirement }) => requirement);
}

/** The ordered rows by group, in page order, without empty groups. */
export function groupRequirements<T extends Orderable>(requirements: readonly T[]): Array<{ id: RequirementGroupId; rows: T[] }> {
  const ordered = orderRequirements(requirements);
  return GROUPS.map((id) => ({ id, rows: ordered.filter((requirement) => groupOf(requirement) === id) })).filter(
    (group) => group.rows.length > 0,
  );
}
