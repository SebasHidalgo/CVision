import { z } from "zod";

export const FEEDBACK_CATEGORIES = [
  "Communication Skills",
  "Technical Knowledge",
  "Problem Solving",
  "Cultural Fit",
  "Confidence and Clarity",
] as const;

// The UI renders the score as a percentage, so a 0-10 answer would show up as
// a near-empty ring. Bounds turn that into an AiFormatError instead.
const scoreSchema = z.number().int().min(0).max(100);

/**
 * What the model is asked for. `totalScore` is deliberately absent: it is
 * arithmetic over these categories, and the model kept returning a number
 * unrelated to them. It is computed with `computeTotalScore` instead.
 */
export const feedbackSchema = z.object({
  categoryScores: z
    .array(
      z.object({
        name: z.enum(FEEDBACK_CATEGORIES),
        score: scoreSchema,
        comment: z.string(),
      }),
    )
    // One entry per category, no repeats: a partial answer used to validate
    // fine and render a feedback page silently missing rows.
    .length(FEEDBACK_CATEGORIES.length)
    .refine(
      (scores) =>
        new Set(scores.map((score) => score.name)).size ===
        FEEDBACK_CATEGORIES.length,
      "categoryScores must cover every category exactly once",
    ),

  strengths: z.array(z.string()),
  areasForImprovement: z.array(z.string()),
  finalAssessment: z.string(),
});

export type AiFeedback = z.infer<typeof feedbackSchema>;

/** What gets persisted: the model's answer plus the score we derive. */
export type FeedbackObject = AiFeedback & { totalScore: number };

/** Mean of the category scores, on the same 0-100 scale. */
export function computeTotalScore(
  categoryScores: AiFeedback["categoryScores"],
): number {
  const sum = categoryScores.reduce((total, { score }) => total + score, 0);
  return Math.round(sum / categoryScores.length);
}
