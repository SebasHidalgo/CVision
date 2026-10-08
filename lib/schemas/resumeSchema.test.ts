import { describe, expect, it } from "vitest";
import {
  deriveFitVerdict,
  describeTally,
  requirementTally,
  resumeFeedbackSchema,
  type RequirementKind,
  type RequirementStatus,
} from "./resumeSchema";

function validFeedback() {
  return {
    overall: {
      qualityScore: 58,
      summaryText: 'A solid match with a few gaps.',
      prioritizedFixes: [
        { title: 'Add measurable results', impact: 'High', action: 'Quantify outcomes.' },
      ],
    },
    atsCompatibility: {
      description: 'Standard sections, clean structure.',
      encodingArtifacts: ['Jos´e'],
      sectionsDetected: ['EXPERIENCE', 'EDUCATION'],
      problems: ['Inconsistent date formats'],
      fixes: ['Use one date format'],
      evidence: ['Jan 2020 - 03/2022'],
    },
    experienceAndImpact: {
      score: 70,
      description: 'Relevant roles, few metrics.',
      quantifiedAchievements: [
        { figure: '40%', quote: 'reducing downtime by approximately 40%' },
      ],
      strengths: ['Strong action verbs'],
      weaknesses: ['Most bullets lack quantified results'],
      suggestedBullets: [{ role: 'Engineer', examples: ['Cut latency by [X]%'] }],
    },
    skills: {
      score: 75,
      description: 'Core skills match.',
      matchedSkills: [{ name: 'React', evidence: 'Three roles' }],
      actionPlan: ['Group skills by category'],
    },
    educationAndCertifications: {
      score: 60,
      description: 'Relevant degree.',
      highlights: ['Computer Science degree'],
      improvements: ['Add relevant coursework'],
      recommendedCerts: [],
    },
    toneAndClarity: {
      score: 78,
      description: 'Clear and concise.',
      suggestions: ['Shorter sentences'],
    },
    jobFit: {
      description: 'Good alignment with the posting.',
      requirements: [
        {
          requirement: '3+ years building web applications',
          kind: 'required',
          status: 'met',
          evidence: 'Full-Stack Developer, 2021 - 2024',
          note: 'Three years in the most recent role.',
        },
      ],
      strategicRecommendations: ['Lead with the checkout work'],
    },
  };
}

// Every score in the analysis goes through the same field schema.
const SCORE_PATHS = [
  'overall.qualityScore',
  'experienceAndImpact.score',
  'toneAndClarity.score',
] as const;
type ScorePath = (typeof SCORE_PATHS)[number];
type Sections = Record<string, Record<string, unknown>>;

/** The parsed score at `path` when `value` is submitted, or "rejected". */
function parsedScore(path: ScorePath, value: unknown): unknown {
  const [section, field] = path.split(".");
  const input = validFeedback() as unknown as Sections;
  input[section][field] = value;

  const result = resumeFeedbackSchema.safeParse(input);
  if (!result.success) return "rejected";
  return (result.data as unknown as Sections)[section][field];
}

describe("resumeFeedbackSchema: shape", () => {
  it("accepts a complete, well-formed analysis", () => {
    expect(resumeFeedbackSchema.safeParse(validFeedback()).success).toBe(true);
  });

  it("rejects an analysis missing a section", () => {
    const { jobFit: _omitted, ...incomplete } = validFeedback();
    expect(resumeFeedbackSchema.safeParse(incomplete).success).toBe(false);
  });
});

describe.each(SCORE_PATHS)("resumeFeedbackSchema: %s", (path) => {
  it("keeps numbers within 0-100, bounds included", () => {
    expect(parsedScore(path, 0)).toBe(0);
    expect(parsedScore(path, 100)).toBe(100);
    expect(parsedScore(path, 85.5)).toBe(85.5);
  });

  it("coerces numeric strings, since small models return them", () => {
    expect(parsedScore(path, "85")).toBe(85);
    expect(parsedScore(path, " 70 ")).toBe(70);
  });

  it.each([-1, 100.5, "101", "abc", Number.NaN])("rejects %s", (value) => {
    expect(parsedScore(path, value)).toBe("rejected");
  });
});

describe("resumeFeedbackSchema: missing scores", () => {
  // Number() would read every one of these as 0 or 1. A score the model did
  // not give must fail validation, never render as a real, very low score.
  // Nested so it.each does not spread `[]` into zero arguments.
  it.each([[null], [""], ["   "], [false], [true], [[]], [{}]])(
    "rejects %j instead of reading it as a number",
    (value) => {
      expect(parsedScore("overall.qualityScore", value)).toBe("rejected");
    },
  );

  it("rejects an absent score", () => {
    expect(parsedScore("overall.qualityScore", undefined)).toBe("rejected");
  });
});

describe("resumeFeedbackSchema: requirements", () => {
  const withRequirements = (requirements: unknown[]) => {
    const input = validFeedback();
    input.jobFit.requirements = requirements as typeof input.jobFit.requirements;
    return resumeFeedbackSchema.safeParse(input);
  };

  const requirement = (over: Record<string, unknown> = {}) => ({
    requirement: "Experience with PostgreSQL",
    kind: "required",
    status: "met",
    evidence: "PostgreSQL",
    note: "Listed in the skills section.",
    ...over,
  });

  // The model answers "Required" and "Met" often enough that rejecting them
  // would throw away a paid analysis over capitalization.
  it.each([
    ["Required", "required"],
    ["  PREFERRED ", "preferred"],
  ])("accepts %j as kind and normalizes it to %j", (sent, expected) => {
    const parsed = withRequirements([requirement({ kind: sent })]);

    expect(parsed.success && parsed.data.jobFit.requirements[0].kind).toBe(expected);
  });

  it.each([
    ["Met", "met"],
    ["PARTIAL", "partial"],
    [" missing ", "missing"],
  ])("accepts %j as status and normalizes it to %j", (sent, expected) => {
    const parsed = withRequirements([requirement({ status: sent })]);

    expect(parsed.success && parsed.data.jobFit.requirements[0].status).toBe(expected);
  });

  // A status outside the set would render as an unmarked row, which reads as
  // "met" to anyone skimming. It has to fail instead.
  it.each(["partially met", "unknown", "", null, 3])("rejects status %j", (status) => {
    expect(withRequirements([requirement({ status })]).success).toBe(false);
  });

  it("rejects a kind outside the two the posting can express", () => {
    expect(withRequirements([requirement({ kind: "optional" })]).success).toBe(false);
  });

  it("accepts an empty evidence string, since quoting nothing beats describing", () => {
    const parsed = withRequirements([
      requirement({ status: "missing", evidence: "" }),
    ]);

    expect(parsed.success).toBe(true);
  });
});

describe("requirementTally", () => {
  const feedbackWith = (requirements: Array<[RequirementKind, RequirementStatus]>) => {
    const input = validFeedback();
    input.jobFit.requirements = requirements.map(([kind, status]) => ({
      requirement: "something",
      kind,
      status,
      evidence: "",
      note: "",
    }));
    return resumeFeedbackSchema.parse(input);
  };

  it("counts met and partial separately, per kind", () => {
    const tally = requirementTally(
      feedbackWith([
        ["required", "met"],
        ["required", "met"],
        ["required", "partial"],
        ["preferred", "met"],
        ["preferred", "missing"],
      ]),
    );

    expect(tally).toEqual({
      required: { total: 3, met: 2, partial: 1 },
      preferred: { total: 2, met: 1, partial: 0 },
    });
  });

  it("reports zeroes rather than throwing when nothing was extracted", () => {
    expect(requirementTally(feedbackWith([]))).toEqual({
      required: { total: 0, met: 0, partial: 0 },
      preferred: { total: 0, met: 0, partial: 0 },
    });
  });
});

/*
 * M2c-F changed the shape, so every analysis stored before it fails this
 * schema. That is deliberate and there are no real users, but it has to be a
 * known consequence rather than a discovered one: mapDbResume validates
 * instead of casting, so such a row comes back with `feedback: null`, the list
 * screen renders it without a score and without a link, and the detail route
 * redirects away. Nothing throws mid-render.
 */
describe("feedback stored before M2c-F", () => {
  const storedBefore = () => ({
    overall: {
      globalScore: 72,
      verdict: "Good",
      summaryText: "A solid match.",
      prioritizedFixes: [],
    },
    atsCompatibility: {
      score: 80,
      description: "Standard sections.",
      problems: [],
      fixes: [],
      evidence: [],
    },
    experienceAndImpact: {
      score: 70,
      description: "Relevant roles.",
      strengths: [],
      weaknesses: [],
      suggestedBullets: [],
    },
    skills: {
      score: 75,
      description: "Core skills match.",
      matchedSkills: [],
      missingSkills: ["GraphQL"],
      actionPlan: [],
    },
    educationAndCertifications: {
      score: 60,
      description: "Relevant degree.",
      highlights: [],
      improvements: [],
      recommendedCerts: [],
    },
    toneAndClarity: {
      score: 78,
      description: "Clear.",
      readability: 65,
      suggestions: [],
    },
    jobFit: {
      score: 74,
      description: "Good alignment.",
      matchedKeywords: [],
      missingKeywords: [],
      strategicRecommendations: [],
    },
  });

  it("no longer validates, so it surfaces as unreadable instead of half-rendered", () => {
    const parsed = resumeFeedbackSchema.safeParse(storedBefore());

    expect(parsed.success).toBe(false);
  });

  it("fails on the fields that carried the meaning, not on a detail", () => {
    const parsed = resumeFeedbackSchema.safeParse(storedBefore());
    const paths = parsed.success
      ? []
      : parsed.error.issues.map((issue) => issue.path.join("."));

    // The two scores that replaced globalScore, and the breakdown that
    // replaced the keyword lists.
    expect(paths).toContain("jobFit.requirements");
    expect(paths).toContain("jobFit.requirements");
    expect(paths).toContain("experienceAndImpact.quantifiedAchievements");
  });
});

describe("deriveFitVerdict", () => {
  const withRequirements = (
    rows: ReadonlyArray<readonly [RequirementKind, RequirementStatus]>,
  ) => {
    const input = validFeedback();
    input.jobFit.requirements = rows.map(([kind, status]) => ({
      requirement: "something",
      kind,
      status,
      evidence: "",
      note: "",
    }));
    return resumeFeedbackSchema.parse(input);
  };

  const verdict = (rows: ReadonlyArray<readonly [RequirementKind, RequirementStatus]>) =>
    deriveFitVerdict(withRequirements(rows)).tone;

  const required = (n: number, status: RequirementStatus = "met") =>
    Array.from({ length: n }, () => ["required", status] as const);
  const preferred = (n: number, status: RequirementStatus = "met") =>
    Array.from({ length: n }, () => ["preferred", status] as const);

  describe("the bar is not cleared", () => {
    it("is weak when a required qualification is missing, however many are met", () => {
      expect(verdict([...required(5), ["required", "missing"], ...preferred(3)])).toBe(
        "weak",
      );
    });

    it("is weak when two required ones are only partial", () => {
      expect(verdict([...required(4), ...required(2, "partial"), ...preferred(3)])).toBe(
        "weak",
      );
    });

    it("tolerates exactly one partial required one", () => {
      expect(verdict([...required(4), ...required(1, "partial"), ...preferred(3)])).toBe(
        "strong",
      );
    });
  });

  describe("the bar is cleared", () => {
    it("is fair when under a third of the preferred ones are met", () => {
      // The case the model would not produce: 6 of 6 required, 1 of 6 preferred.
      expect(verdict([...required(6), ...preferred(1), ...preferred(5, "missing")])).toBe(
        "fair",
      );
    });

    it("is strong at exactly a third", () => {
      expect(verdict([...required(2), ...preferred(1), ...preferred(2, "missing")])).toBe(
        "strong",
      );
    });

    it("counts a partial preferred one as half", () => {
      // 3 partial out of 4 = 1.5/4 = 0.375, over the third.
      expect(verdict([...required(2), ...preferred(3, "partial"), ...preferred(1, "missing")])).toBe(
        "strong",
      );
      // 2 partial out of 4 = 1.0/4 = 0.25, under it - two halves are not two.
      expect(verdict([...required(2), ...preferred(2, "partial"), ...preferred(2, "missing")])).toBe(
        "fair",
      );
    });

    it("is strong when the posting states no preferred qualifications", () => {
      // Nothing left to differentiate on, so meeting everything asked is as
      // strong as the posting allows.
      expect(verdict(required(3))).toBe("strong");
    });
  });

  it("is weak when the posting yielded no requirements at all", () => {
    // Not "strong by default": an empty breakdown supports no verdict, and the
    // headline must not read as a pass.
    expect(verdict([])).toBe("weak");
  });

  it("carries the counts it was computed from, so the verdict is checkable", () => {
    const fit = deriveFitVerdict(
      withRequirements([...required(2), ...preferred(2), ...preferred(2, "missing")]),
    );

    expect(fit.tally).toEqual({
      required: { total: 2, met: 2, partial: 0 },
      preferred: { total: 4, met: 2, partial: 0 },
    });
    expect(describeTally(fit.tally)).toBe("2 of 2 required, 2 of 4 preferred");
  });

  it("names partials in the description, since they are half-counted", () => {
    const fit = deriveFitVerdict(
      withRequirements([...required(1), ...required(1, "partial"), ...preferred(1, "partial")]),
    );

    expect(describeTally(fit.tally)).toBe(
      "1 of 2 required (+1 partial), 0 of 1 preferred (+1 partial)",
    );
  });
});
