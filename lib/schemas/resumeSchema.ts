import { z } from "zod";
import { aiScoreSchema } from "@/lib/ai/schemas";
import type { ScoreTone } from "@/lib/score";
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
    // There is no fitScore. The model was asked for one three ways - a plain
    // judgement, a weighted average of the statuses, and explicit
    // competitiveness anchors - and it would not tabulate its own breakdown
    // any of them: it scored 88 on 6 of 6 required and 1 of 6 preferred, which
    // its own anchor put at 50-69. `deriveFitVerdict` computes it instead, the
    // same move that fixed the date anchor: compute the fact, do not ask.
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

  // No score, and before it no readability number. Readability went first
  // because it moved up to 20 points between identical runs; the section
  // score went because it measured nothing either. Over three phases it
  // separated fixtures only 1.3x as far as it separated identical runs of
  // one fixture, spanned 75-92 across every fixture in the suite including a
  // resume for the wrong profession, and correlated 0.85-0.96 with
  // qualityScore. A number that says "good" about everything can only
  // mislead. The prose stays, as it does for atsCompatibility.
  toneAndClarity: z.object({
    ...evidenceSectionBase,
    suggestions: z.array(z.string()),
  }),

  // No score of its own: the verdict is derived from the breakdown below, so a
  // number here could only disagree with it.
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

export type RequirementTally = ReturnType<typeof requirementTally>;

/**
 * Two preferred qualifications met is where differentiating starts. An
 * absolute count, not a fraction: a fraction over a denominator of one or zero
 * cannot carry a claim about standing out, and it produced a cliff. One
 * posting read as 0 preferred gave the top verdict (nothing left to
 * differentiate on) while the same posting read as 1 preferred and unmet gave
 * the middle one, so an extraction wobble swung the headline. A count has no
 * such edge: nothing met is nothing met, however many were asked for.
 *
 * A partial still counts as half, as it does for required qualifications. That
 * part of the rule was not the problem and is left alone.
 */
const DIFFERENTIATING_PREFERRED = 2;

export type FitVerdict = {
  tone: ScoreTone;
  /** The counts the verdict was computed from, so a user can check it. */
  tally: RequirementTally;
};

/**
 * The fit verdict, as a function of the breakdown rather than a number the
 * model picked. Fit is competitiveness: clearing every required qualification
 * is the entry condition, and the preferred ones are what differentiate.
 *
 *   weak   - the bar is not cleared: a required qualification missing, or two
 *            or more only partial.
 *   fair   - the bar is cleared and nothing differentiates: fewer than two
 *            preferred qualifications met, including the case where the
 *            posting states none at all - there is nothing there to stand out
 *            on, so clearing the bar is all this says.
 *   strong - the bar is cleared and two or more preferred ones are met.
 *
 * Partial counts as half a preferred item and as not-met for a required one,
 * which is why one partial required is tolerated and two are not.
 *
 * Derived on read, never stored: a stored copy could drift from the breakdown
 * it describes, and this cannot. Given a correct breakdown it is correct by
 * construction, which moves the measurement to the eleven assertions that
 * check the breakdown itself.
 */
export function deriveFitVerdict(feedback: ResumeAnalysisFeedback): FitVerdict {
  const tally = requirementTally(feedback);
  const { required, preferred } = tally;

  // An empty breakdown supports no verdict, and the arithmetic below would
  // read it as "nothing unmet, nothing to differentiate on" and return the
  // best one. A posting that yielded no requirements is an extraction failure,
  // and it must not surface as a confident pass.
  if (required.total === 0) return { tone: "weak", tally };

  const barCleared =
    required.total - required.met - required.partial === 0 && required.partial <= 1;

  if (!barCleared) return { tone: "weak", tally };

  const differentiators = preferred.met + 0.5 * preferred.partial;
  return {
    tone: differentiators >= DIFFERENTIATING_PREFERRED ? "strong" : "fair",
    tally,
  };
}

/** "2 of 2 required, 2 of 4 preferred" - the arithmetic, in the open. */
export function describeTally(tally: RequirementTally): string {
  const part = (label: string, count: RequirementTally["required"]) =>
    `${count.met} of ${count.total} ${label}${count.partial ? ` (+${count.partial} partial)` : ""}`;

  return `${part("required", tally.required)}, ${part("preferred", tally.preferred)}`;
}
