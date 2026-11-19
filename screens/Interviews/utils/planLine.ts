import { AGENT_SECONDS, type InterviewEntitlement } from "@/lib/interviewEntitlement";
import type { PlanId } from "@/lib/plans";

/** One fact of the plan line: a key under `interview:list.plan` and its values. */
export type PlanPart =
  | { key: "period"; count: number; limit: number }
  | { key: "credits"; count: number }
  | { key: "resets"; resetsAt: string }
  | { key: "trial"; minutes: number }
  | { key: "creditsFree"; count: number; minutes: number }
  | { key: "periodUsed"; resetsAt: string }
  | { key: "needsPro" };

export type PlanLine = {
  plan: PlanId;
  parts: PlanPart[];
  /** What to do when nothing is left: buy more (Pro) or see Pro (Free). */
  link: "getMore" | "seePro" | null;
};

const TRIAL_MINUTES = Math.round(AGENT_SECONDS.trial / 60);
const FULL_MINUTES = Math.round(AGENT_SECONDS.main / 60);

/**
 * What the plan has left to rehearse with, from the entitlement every page reads: a Pro's interviews this period, its
 * credits and the reset; a Free account's credits (full interviews) and its trial; or that nothing is left, and the way
 * to more. Never Pro's analyses.
 */
export function planLine(entitlement: InterviewEntitlement): PlanLine {
  const { remaining, resetsAt } = entitlement;
  const credits = remaining.credits;

  if (entitlement.plan === "PRO") {
    if (remaining.period === 0 && credits === 0) {
      return { plan: "PRO", parts: resetsAt ? [{ key: "periodUsed", resetsAt }] : [], link: "getMore" };
    }
    return {
      plan: "PRO",
      parts: [
        { key: "period", count: remaining.period, limit: remaining.periodLimit },
        ...(credits > 0 ? [{ key: "credits" as const, count: credits }] : []),
        ...(resetsAt ? [{ key: "resets" as const, resetsAt }] : []),
      ],
      link: null,
    };
  }

  const parts: PlanPart[] = [
    ...(credits > 0 ? [{ key: "creditsFree" as const, count: credits, minutes: FULL_MINUTES }] : []),
    ...(remaining.trial > 0 ? [{ key: "trial" as const, minutes: TRIAL_MINUTES }] : []),
  ];
  return parts.length > 0 ? { plan: "FREE", parts, link: null } : { plan: "FREE", parts: [{ key: "needsPro" }], link: "seePro" };
}
