import { FEEDBACK_CATEGORIES, interviewFeedbackReportSchema } from "@/lib/ai/schemas";

/** The seeded interview's report, built the same way by the seed and by the translation capture. */
export function seededReport(fixture: { report: Record<string, unknown> }) {
  return interviewFeedbackReportSchema.parse({
    ...fixture.report,
    categoryScores: FEEDBACK_CATEGORIES.map((name, i) => ({ name, score: 60 + i * 4, comment: `Steady on ${name.toLowerCase()}, with one concrete example.` })),
  });
}
