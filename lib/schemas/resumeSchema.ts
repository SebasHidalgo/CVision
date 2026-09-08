import { z } from "zod";

export const MAX_RESUME_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_JOB_DESCRIPTION_CHARS = 8000;

// z.instanceof(File) evaluates File at import time and breaks where it is not
// a global.
const fileSchema = z.custom<File>(
  (value) => typeof File !== "undefined" && value instanceof File,
  { message: "A file is required" },
);

/**
 * Shared by the upload form (zodResolver) and the server action. The client
 * check is UX; the server one is the actual guard.
 */
export const createResumeInputSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(100),
  jobTitle: z.string().trim().min(1, "Job title is required").max(120),
  jobDescription: z
    .string()
    .trim()
    .min(1, "Job description is required")
    .max(MAX_JOB_DESCRIPTION_CHARS, "Job description is too long"),
  resume: fileSchema
    .refine(
      (file) => file.type === "application/pdf",
      "Only PDF files are allowed",
    )
    .refine((file) => file.size > 0, "The file is empty")
    .refine((file) => file.size <= MAX_RESUME_BYTES, "The file exceeds 20 MB"),
});

export type CreateResumeInput = z.infer<typeof createResumeInputSchema>;

// Coerced: small models return "85" or 85.5 as often as 85.
const scoreSchema = z.coerce.number().min(0).max(100);

const sectionBase = {
  score: scoreSchema,
  description: z.string(),
};

/** Contract for the AI output. Nothing that fails it reaches the database. */
export const resumeFeedbackSchema = z.object({
  overall: z.object({
    globalScore: scoreSchema,
    // Open string rather than an enum: it is cosmetic, and rejecting a whole
    // analysis over a synonym costs more than rendering the word.
    verdict: z.string().min(1).max(40),
    summaryText: z.string(),
    prioritizedFixes: z.array(
      z.object({
        title: z.string(),
        impact: z.string().min(1).max(20),
        action: z.string(),
      }),
    ),
  }),

  atsCompatibility: z.object({
    ...sectionBase,
    problems: z.array(z.string()),
    fixes: z.array(z.string()),
    evidence: z.array(z.string()),
  }),

  experienceAndImpact: z.object({
    ...sectionBase,
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    suggestedBullets: z.array(
      z.object({ role: z.string(), examples: z.array(z.string()) }),
    ),
  }),

  skills: z.object({
    ...sectionBase,
    matchedSkills: z.array(
      z.object({ name: z.string(), evidence: z.string() }),
    ),
    missingSkills: z.array(z.string()),
    actionPlan: z.array(z.string()),
  }),

  educationAndCertifications: z.object({
    ...sectionBase,
    highlights: z.array(z.string()),
    improvements: z.array(z.string()),
    recommendedCerts: z.array(z.string()),
  }),

  toneAndClarity: z.object({
    ...sectionBase,
    readability: scoreSchema,
    suggestions: z.array(z.string()),
  }),

  jobFit: z.object({
    ...sectionBase,
    matchedKeywords: z.array(z.string()),
    missingKeywords: z.array(z.string()),
    strategicRecommendations: z.array(z.string()),
  }),
});

export type ResumeAnalysisFeedback = z.infer<typeof resumeFeedbackSchema>;
