import { describe, expect, it } from "vitest";
import { resumeFeedbackSchema } from "./resumeSchema";

function validFeedback() {
  return {
    overall: {
      globalScore: 72,
      verdict: "Good",
      summaryText: "A solid match with a few gaps.",
      prioritizedFixes: [
        { title: "Add measurable results", impact: "High", action: "Quantify outcomes." },
      ],
    },
    atsCompatibility: {
      score: 80,
      description: "Standard sections, clean structure.",
      problems: ["Inconsistent date formats"],
      fixes: ["Use one date format"],
      evidence: ["Jan 2020 - 03/2022"],
    },
    experienceAndImpact: {
      score: 70,
      description: "Relevant roles, few metrics.",
      strengths: ["Strong action verbs"],
      weaknesses: ["Few quantified results"],
      suggestedBullets: [{ role: "Engineer", examples: ["Cut latency by 40%"] }],
    },
    skills: {
      score: 75,
      description: "Core skills match.",
      matchedSkills: [{ name: "React", evidence: "Three roles" }],
      missingSkills: ["GraphQL"],
      actionPlan: ["Group skills by category"],
    },
    educationAndCertifications: {
      score: 60,
      description: "Relevant degree.",
      highlights: ["Computer Science degree"],
      improvements: ["Add graduation year"],
      recommendedCerts: [],
    },
    toneAndClarity: {
      score: 78,
      description: "Clear and concise.",
      readability: 65,
      suggestions: ["Shorter sentences"],
    },
    jobFit: {
      score: 74,
      description: "Good alignment with the posting.",
      matchedKeywords: ["React"],
      missingKeywords: ["GraphQL"],
      strategicRecommendations: ["Lead with the checkout work"],
    },
  };
}

// Every score in the analysis goes through the same field schema.
const SCORE_PATHS = [
  "overall.globalScore",
  "atsCompatibility.score",
  "jobFit.score",
  "toneAndClarity.readability",
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
  // KNOWN DEFECT, fails today: z.coerce.number() runs Number() first, so a
  // missing or empty score becomes 0 and is shown as a real, very low score
  // instead of failing validation. Drop `.fails` once fixed.
  for (const value of [null, "", false]) {
    it.fails(`rejects ${JSON.stringify(value)} instead of reading it as 0`, () => {
      expect(parsedScore("overall.globalScore", value)).toBe("rejected");
    });
  }
});
