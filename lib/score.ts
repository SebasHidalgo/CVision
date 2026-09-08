/**
 * One scale for every score in the product. Analyses, interview feedback and
 * list rows used to disagree on where "good" started.
 */
export type ScoreTone = "weak" | "fair" | "strong";

export const SCORE_THRESHOLDS = { fair: 50, strong: 70 } as const;

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreTone(score: number): ScoreTone {
  const value = clampScore(score);
  if (value >= SCORE_THRESHOLDS.strong) return "strong";
  if (value >= SCORE_THRESHOLDS.fair) return "fair";
  return "weak";
}

/** Generic wording, for a section or a skill area. */
export const TONE_LABEL: Record<ScoreTone, string> = {
  weak: "Needs work",
  fair: "Fair",
  strong: "Strong",
};

/** Wording for the headline question: does this CV fit this job? */
export const FIT_LABEL: Record<ScoreTone, string> = {
  weak: "Weak fit",
  fair: "Partial fit",
  strong: "Strong fit",
};

/** Wording for the interview performance total. */
export const PERFORMANCE_LABEL: Record<ScoreTone, string> = {
  weak: "Needs practice",
  fair: "Solid",
  strong: "Convincing",
};

// Literal class names so Tailwind can see them.
export const TONE_CLASS: Record<
  ScoreTone,
  { text: string; bg: string; soft: string; border: string }
> = {
  weak: {
    text: "text-weak",
    bg: "bg-weak",
    soft: "bg-weak-soft",
    border: "border-weak",
  },
  fair: {
    text: "text-fair",
    bg: "bg-fair",
    soft: "bg-fair-soft",
    border: "border-fair",
  },
  strong: {
    text: "text-strong",
    bg: "bg-strong",
    soft: "bg-strong-soft",
    border: "border-strong",
  },
};
