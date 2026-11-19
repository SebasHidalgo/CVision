import type { TFunction } from "i18next";
import type { AnchoredPoint, FEEDBACK_CATEGORIES, GapOutcome, InterviewFeedbackReport, InterviewStats } from "@/lib/ai/schemas";
import { INTERVIEW_TIERS } from "@/lib/plans";

// What the report's labels read off the stored report: pure, so the page, the landing and the tests share them. Types
// only from lib/ai/schemas: the landing renders this too, and the schemas would bring zod into its bundle.

/** The outcome's label under `report.outcome`. */
export const OUTCOME_KEY = {
  addressed: "report.outcome.addressed",
  partially: "report.outcome.partially",
  dodged: "report.outcome.dodged",
  not_raised: "report.outcome.notRaised",
} as const satisfies Record<GapOutcome, string>;

/** The five categories' ids under `categories`, in the stored enum's order. */
export const CATEGORY_IDS = ["communicationSkills", "technicalKnowledge", "problemSolving", "culturalFit", "confidenceAndClarity"] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];
type Category = (typeof FEEDBACK_CATEGORIES)[number];

/** "Confidence and Clarity" → "confidenceAndClarity": a stored category's id (report.test.ts holds every one to its id). */
export function categoryId(name: Category): CategoryId {
  return name
    .split(" ")
    .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join("") as CategoryId;
}

/** "confidenceAndClarity" → "Confidence and Clarity": the stored value of a category id. */
export function categoryName(id: CategoryId): Category {
  return id
    .split(/(?=[A-Z])/)
    .map((word) => (word.toLowerCase() === "and" ? "and" : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ") as Category;
}

/** The stored category is an enum value; its heading is the label of its id in the interface language. */
export function categoryKey(name: Category): `categories.${CategoryId}` {
  return `categories.${categoryId(name)}`;
}

/** The five readings in one fixed order, so two attempts read side by side. */
export function orderedCategories(report: InterviewFeedbackReport): InterviewFeedbackReport["categoryScores"] {
  const at = (name: Category) => CATEGORY_IDS.indexOf(categoryId(name));
  return [...report.categoryScores].sort((a, b) => at(a.name) - at(b.name));
}

/**
 * "6 answers · 54 words each · about 5 min on the floor", from the measured stats (summed over every call of a resumed
 * interview). "On the floor" runs from each answer's start to the interviewer's next turn, so it includes the pause.
 */
export function describeStats(stats: InterviewStats, t: TFunction<"feedback">): string {
  const parts = [
    t("stats.answers", { count: stats.candidateTurns }),
    t("stats.wordsEach", { count: Math.round(stats.averageCandidateTurnWords) }),
  ];
  if (stats.candidateOnFloorSeconds !== null) {
    parts.push(t("stats.onFloor", { count: Math.max(1, Math.round(stats.candidateOnFloorSeconds / 60)) }));
  }
  return parts.join(" · ");
}

/** The length "short" was measured against; reports stored before the trial existed were all full interviews. */
export function plannedMinutes(stats: InterviewStats): number {
  return Math.round((stats.plannedSeconds ?? INTERVIEW_TIERS.FULL.seconds) / 60);
}

/** What a point rests on: the candidate's words, or (a gap row with nothing quotable) the gap it is about. */
export type PointAnchor = { kind: "quote"; text: string } | { kind: "gap"; text: string };

export function anchorOf(report: InterviewFeedbackReport, point: AnchoredPoint): PointAnchor | null {
  const { source, index } = point.anchor;
  if (source === "notableAnswers") {
    const quote = report.notableAnswers[index]?.quote.trim();
    return quote ? { kind: "quote", text: quote } : null;
  }
  const row = report.gapFollowThrough[index];
  if (!row) return null;
  return row.quote.trim() ? { kind: "quote", text: row.quote } : { kind: "gap", text: row.requirement };
}

/** The guardrail empties a quote it could not find in the transcript: a "why" without its answer is not shown. */
export function quotedAnswers(report: InterviewFeedbackReport): InterviewFeedbackReport["notableAnswers"] {
  return report.notableAnswers.filter((answer) => answer.quote.trim());
}
