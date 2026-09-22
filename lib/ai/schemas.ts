import { z } from "zod";

const NUMERIC_STRING = /^\s*-?\d+(\.\d+)?\s*$/;

/**
 * A 0-100 score as the model may reasonably send it: a number, or a number
 * quoted as a string. Anything else (null, "", booleans, arrays) is a schema
 * violation, never a zero: `z.coerce.number()` used to turn a missing score
 * into a real-looking 0 on the user's screen.
 *
 * Serializes to a plain `number` in JSON Schema, so the model is asked for
 * numbers; the string branch is only tolerance on the way in.
 */
export function aiScoreSchema({ integer = false }: { integer?: boolean } = {}) {
  const bounded = z.number().min(0).max(100);
  return z.preprocess(
    (value) =>
      typeof value === "string" && NUMERIC_STRING.test(value)
        ? Number(value)
        : value,
    integer ? bounded.int() : bounded,
  );
}

export const FEEDBACK_CATEGORIES = [
  "Communication Skills",
  "Technical Knowledge",
  "Problem Solving",
  "Cultural Fit",
  "Confidence and Clarity",
] as const;

// The UI renders the score as a percentage, so a 0-10 answer would show up as
// a near-empty ring. Bounds turn that into an AiFormatError instead.
const scoreSchema = aiScoreSchema({ integer: true });

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
