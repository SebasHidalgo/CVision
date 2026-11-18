import type { MarkStatus } from "@/components/design-system/StatusMark";
import { requirementsOfKind, type REQUIREMENT_STATUSES, type ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

const MARK: Record<(typeof REQUIREMENT_STATUSES)[number], MarkStatus> = { met: "met", partial: "partial", missing: "missing", not_evident: "notshown" };
const ORDER: MarkStatus[] = ["met", "partial", "missing", "notshown"];

/**
 * One status mark per requirement, met first, so a row shows its proportion at a glance. Decorative: the tally
 * beside it says the same in words.
 */
export function requirementMarks(feedback: ResumeAnalysisFeedback): { required: MarkStatus[]; preferred: MarkStatus[] } {
  const marks = (kind: "required" | "preferred") =>
    requirementsOfKind(feedback, kind)
      .map((requirement) => MARK[requirement.status])
      .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return { required: marks("required"), preferred: marks("preferred") };
}
