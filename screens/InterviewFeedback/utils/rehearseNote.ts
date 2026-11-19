import { AGENT_SECONDS, type InterviewEntitlement } from "@/lib/interviewEntitlement";

/** One fact of the note under "Rehearse again": a key under `next.note` and its values. */
export type NotePart =
  | { key: "period"; count: number; limit: number }
  | { key: "credits" | "creditsLeft"; count: number }
  | { key: "trial"; minutes: number }
  | { key: "periodUsed"; resetsAt: string }
  | { key: "needsPro" };

export type RehearseNote = {
  parts: NotePart[];
  /** A fresh start is on offer: the action says "Rehearse again"; otherwise it opens the analysis, which says what to buy. */
  canStart: boolean;
};

/**
 * What the plan has left for the next rehearsal, read off the entitlement (the one decision of what a start gets), in
 * the words the analysis page's control uses: Pro's period count with its credits, a Free account's credits or trial,
 * or why there is none.
 */
export function rehearseNote(entitlement: InterviewEntitlement): RehearseNote {
  const { remaining } = entitlement;
  switch (entitlement.source) {
    case "period":
      return { canStart: true, parts: [{ key: "period", count: remaining.period, limit: remaining.periodLimit }, ...credits(remaining.credits)] };
    case "credit":
      return entitlement.plan === "PRO"
        ? { canStart: true, parts: [{ key: "period", count: remaining.period, limit: remaining.periodLimit }, ...credits(remaining.credits)] }
        : { canStart: true, parts: [{ key: "creditsLeft", count: remaining.credits }] };
    case "trial":
      return { canStart: true, parts: [{ key: "trial", minutes: Math.round(AGENT_SECONDS.trial / 60) }] };
    case "none":
      return entitlement.plan === "PRO" && entitlement.resetsAt
        ? { canStart: false, parts: [{ key: "periodUsed", resetsAt: entitlement.resetsAt }] }
        : { canStart: false, parts: [{ key: "needsPro" }] };
  }
}

function credits(count: number): NotePart[] {
  return count > 0 ? [{ key: "credits", count }] : [];
}
