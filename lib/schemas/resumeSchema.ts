import { z } from "zod";
import { aiScoreSchema } from "@/lib/ai/schemas";
import { MAX_RESUME_BYTES, MAX_RESUME_SIZE_LABEL } from "@/lib/uploadLimits";

export const MAX_COMPANY_NAME_CHARS = 100;
export const MAX_JOB_TITLE_CHARS = 120;
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
  companyName: z
    .string()
    .trim()
    .min(1, "Company name is required")
    .max(MAX_COMPANY_NAME_CHARS),
  jobTitle: z
    .string()
    .trim()
    .min(1, "Job title is required")
    .max(MAX_JOB_TITLE_CHARS),
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
    .refine((file) => file.size <= MAX_RESUME_BYTES, `The file is larger than ${MAX_RESUME_SIZE_LABEL}`),
});

export type CreateResumeInput = z.infer<typeof createResumeInputSchema>;

// Numbers or numeric strings only; an absent score is a violation, not a 0.
const scoreSchema = aiScoreSchema();

const sectionBase = {
  score: scoreSchema,
  description: z.string(),
};

/** A section whose job is to show evidence, not to award a number. */
const evidenceSectionBase = {
  description: z.string(),
};

/**
 * Case and surrounding space are tolerated on the way in. The model answers
 * "Required" often enough that rejecting it would throw away a paid analysis
 * over capitalization.
 */
const lowerEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.enum(values),
  );

export const REQUIREMENT_KINDS = ["required", "preferred"] as const;
export const REQUIREMENT_STATUSES = ["met", "partial", "missing"] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/**
 * One requirement from the posting, with how the resume answers it. This is
 * the unit the analysis is built on, and the reason is measured: while the
 * output asked for "missing keywords", every alternative in a list like
 * "C, C++, C#, Java, JavaScript, or Python" read as its own gap, and five
 * phrasings of a rule telling the model otherwise never fixed it. One
 * requirement that any single alternative satisfies leaves the error nowhere
 * to live.
 */
const requirementSchema = z.object({
  requirement: z.string(),
  kind: lowerEnum(REQUIREMENT_KINDS),
  status: lowerEnum(REQUIREMENT_STATUSES),
  /** Verbatim from the resume, or empty when there is nothing to quote. */
  evidence: z.string(),
  note: z.string(),
});

export type Requirement = z.infer<typeof requirementSchema>;

/** A measured outcome the resume already states, and the line it comes from. */
const quantifiedAchievementSchema = z.object({
  figure: z.string(),
  /** Verbatim from the resume. */
  quote: z.string(),
});

export type QuantifiedAchievement = z.infer<typeof quantifiedAchievementSchema>;

/** Contract for the AI output. Nothing that fails it reaches the database. */
export const resumeFeedbackSchema = z.object({
  overall: z.object({
    // Two questions, two answers. The old single globalScore conflated them,
    // and three measurements showed it tracked neither: it did not move when
    // the input went from flattened text to a real document, it moved up when
    // fabricated gaps were removed, and it swung 13 points on a fixture whose
    // analysis content never changed.
    fitScore: scoreSchema,
    qualityScore: scoreSchema,
    summaryText: z.string(),
    prioritizedFixes: z.array(
      z.object({
        title: z.string(),
        impact: z.string().min(1).max(20),
        action: z.string(),
      }),
    ),
  }),

  // No score: the model sees exactly what an ATS sees, so here it can report
  // facts instead of an impression. A number invited "improve my ATS score",
  // which is not a measurable request.
  atsCompatibility: z.object({
    ...evidenceSectionBase,
    encodingArtifacts: z.array(z.string()),
    sectionsDetected: z.array(z.string()),
    problems: z.array(z.string()),
    fixes: z.array(z.string()),
    evidence: z.array(z.string()),
  }),

  experienceAndImpact: z.object({
    ...sectionBase,
    quantifiedAchievements: z.array(quantifiedAchievementSchema),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    suggestedBullets: z.array(
      z.object({ role: z.string(), examples: z.array(z.string()) }),
    ),
  }),

  // missingSkills is gone: a gap is now an unmet requirement, which has to
  // name the posting text it comes from.
  skills: z.object({
    ...sectionBase,
    matchedSkills: z.array(z.object({ name: z.string(), evidence: z.string() })),
    actionPlan: z.array(z.string()),
  }),

  educationAndCertifications: z.object({
    ...sectionBase,
    highlights: z.array(z.string()),
    improvements: z.array(z.string()),
    recommendedCerts: z.array(z.string()),
  }),

  // readability is gone: it moved up to 20 points between identical runs.
  toneAndClarity: z.object({
    ...sectionBase,
    suggestions: z.array(z.string()),
  }),

  // No score of its own either: overall.fitScore is that number, and a second
  // copy could only disagree with it. What belongs here is the breakdown.
  jobFit: z.object({
    ...evidenceSectionBase,
    requirements: z.array(requirementSchema),
    strategicRecommendations: z.array(z.string()),
  }),
});

export type ResumeAnalysisFeedback = z.infer<typeof resumeFeedbackSchema>;

/** Requirements of one kind, in the order the model listed them. */
export function requirementsOfKind(
  feedback: ResumeAnalysisFeedback,
  kind: RequirementKind,
): Requirement[] {
  return feedback.jobFit.requirements.filter(
    (requirement) => requirement.kind === kind,
  );
}

/**
 * "You meet both required qualifications and two of four preferred ones" - the
 * answer the user actually came for, which a number never gave them.
 */
export function requirementTally(feedback: ResumeAnalysisFeedback) {
  const count = (kind: RequirementKind) => {
    const all = requirementsOfKind(feedback, kind);
    return {
      total: all.length,
      met: all.filter((requirement) => requirement.status === "met").length,
      partial: all.filter((requirement) => requirement.status === "partial").length,
    };
  };

  return { required: count("required"), preferred: count("preferred") };
}
