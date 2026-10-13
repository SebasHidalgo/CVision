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

/**
 * Case and surrounding space are tolerated on the way in, as the analysis
 * schema does: rejecting "Addressed" would throw away a paid call over
 * capitalization.
 */
const lowerEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(values),
  );

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
 * What happened, in the interview, to a gap the analysis found.
 *
 *   addressed   a concrete example or specific knowledge that answers it
 *   partially   something relevant, but general or incomplete
 *   not_raised  the interviewer never asked about it, or the candidate was
 *               never given the chance
 *   dodged      asked, and the answer avoided it or stayed at "familiar with"
 */
export const GAP_OUTCOMES = ["addressed", "partially", "not_raised", "dodged"] as const;
export type GapOutcome = (typeof GAP_OUTCOMES)[number];

/**
 * One row per gap the analysis found. This is what connects the two halves
 * of the product: the analysis said what to probe, the agent probed it, this
 * says what happened. The model has to fill a row per gap, so it cannot wave
 * at the interview as a whole.
 */
const gapFollowThroughSchema = z.object({
  /** The requirement as the material lists it, copied. */
  requirement: z.string(),
  outcome: lowerEnum(GAP_OUTCOMES),
  /** Verbatim from a CANDIDATE turn, or "" when nothing is quotable. */
  quote: z.string(),
  note: z.string(),
});

export type GapFollowThrough = z.infer<typeof gapFollowThroughSchema>;

/** An answer worth showing back, good or bad, with the words that make it so. */
const notableAnswerSchema = z.object({
  /** Verbatim from a CANDIDATE turn. */
  quote: z.string(),
  /** Whether it helped the candidate's case. */
  worked: z.boolean(),
  why: z.string(),
});

export type NotableAnswer = z.infer<typeof notableAnswerSchema>;

/**
 * Where a strength or an area for improvement comes from. Every one of them
 * must point at something the candidate said: a notable answer or a gap row.
 * Praise with no anchor is the "great communicator" line nobody can act on.
 */
export const ANCHOR_SOURCES = ["notableAnswers", "gapFollowThrough"] as const;

const anchorSchema = z.object({
  source: z.enum(ANCHOR_SOURCES),
  /** Index into that list, as returned in this same answer. */
  index: z.number().int().min(0),
});

export type FeedbackAnchor = z.infer<typeof anchorSchema>;

const anchoredPointSchema = z.object({
  point: z.string(),
  anchor: anchorSchema,
});

export type AnchoredPoint = z.infer<typeof anchoredPointSchema>;

/**
 * What the model is asked for. `totalScore` is deliberately absent: it is
 * arithmetic over the categories, and the model kept returning a number
 * unrelated to them. `interviewStats` is absent too: it is computed from the
 * transcript's timings in code and handed to the model as data.
 */
export const feedbackSchema = z.object({
  gapFollowThrough: z.array(gapFollowThroughSchema),
  notableAnswers: z.array(notableAnswerSchema),

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

  strengths: z.array(anchoredPointSchema),
  areasForImprovement: z.array(anchoredPointSchema),
  finalAssessment: z.string(),
});

export type AiFeedback = z.infer<typeof feedbackSchema>;

/**
 * Facts about the transcript, computed in code: the one part of the feedback
 * with zero variance. Time-based figures are null when the turns carry no
 * offsets (the legacy browser transcript).
 */
export const interviewStatsSchema = z.object({
  totalTurns: z.number().int().min(0),
  candidateTurns: z.number().int().min(0),
  candidateWords: z.number().int().min(0),
  averageCandidateTurnWords: z.number().min(0),
  /**
   * Seconds the candidate held the floor: from each candidate turn's start to
   * the next turn's start, so speaking time plus the pause before the
   * interviewer replied. An upper bound on speaking, never "speaking time".
   */
  candidateOnFloorSeconds: z.number().min(0).nullable(),
  /** Longest span between two consecutive turn starts; an upper bound on silence. */
  longestTurnGapSeconds: z.number().min(0).nullable(),
  durationSeconds: z.number().min(0).nullable(),
  /** Under two minutes on the floor or fewer than four turns: scores are low-confidence. */
  short: z.boolean(),
});

export type InterviewStats = z.infer<typeof interviewStatsSchema>;

/** What gets persisted: the model's answer plus what the code derived. */
export const interviewFeedbackReportSchema = feedbackSchema.extend({
  totalScore: scoreSchema,
  interviewStats: interviewStatsSchema,
});

export type InterviewFeedbackReport = z.infer<typeof interviewFeedbackReportSchema>;

/** Mean of the category scores, on the same 0-100 scale. */
export function computeTotalScore(
  categoryScores: AiFeedback["categoryScores"],
): number {
  const sum = categoryScores.reduce((total, { score }) => total + score, 0);
  return Math.round(sum / categoryScores.length);
}
