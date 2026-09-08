import { z } from "zod";

export const feedbackSchema = z.object({
  totalScore: z.number(),

  categoryScores: z.array(
    z.object({
      name: z.enum([
        "Communication Skills",
        "Technical Knowledge",
        "Problem Solving",
        "Cultural Fit",
        "Confidence and Clarity",
      ]),
      score: z.number(),
      comment: z.string(),
    }),
  ),

  strengths: z.array(z.string()),
  areasForImprovement: z.array(z.string()),
  finalAssessment: z.string(),
});

export type FeedbackObject = z.infer<typeof feedbackSchema>;
