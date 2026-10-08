import { describe, expect, it } from "vitest";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import {
  checkAnalysis,
  checkEvidenceGrounding,
  checkFabricatedNumbers,
  checkFalseMissing,
  checkMissedFigures,
  countByCheck,
  countGrounding,
} from "./analysisChecks";

const CV = [
  "JANE DOE — Backend Engineer",
  "",
  "EXPERIENCE",
  "Northwind, Backend Engineer, 2021 to present",
  "- Built backend services using Node.js.",
  "- Designed REST APIs with Express.js.",
  "- Improved deployment reliability, reducing downtime by approximately 40%.",
  "",
  "SKILLS",
  "Docker, CI/CD, Git, C#, Java, JavaScript, Scalability, Google Cloud",
  "",
  "EDUCATION",
  "B.S. Computer Science, 2018. AWS Certified Developer.",
].join("\n");

/** A complete, schema-shaped analysis. Each test overrides only what it needs. */
function feedback(
  overrides: Partial<ResumeAnalysisFeedback> = {},
): ResumeAnalysisFeedback {
  const section = { score: 70, description: '' };
  return {
    overall: {
      qualityScore: 55,
      summaryText: '',
      prioritizedFixes: [],
    },
    atsCompatibility: {
      description: '',
      encodingArtifacts: [],
      sectionsDetected: [],
      problems: [],
      fixes: [],
      evidence: [],
    },
    experienceAndImpact: {
      ...section,
      quantifiedAchievements: [
      { figure: '40%', quote: '- Improved deployment reliability, reducing downtime by approximately 40%.' },
    ],
      strengths: [],
      weaknesses: [],
      suggestedBullets: [],
    },
    skills: { ...section, matchedSkills: [], actionPlan: [] },
    educationAndCertifications: {
      ...section,
      highlights: [],
      improvements: [],
      recommendedCerts: [],
    },
    toneAndClarity: { ...section, suggestions: [] },
    jobFit: { description: '', requirements: [], strategicRecommendations: [] },
    ...overrides,
  };
}

const withEvidence = (...evidence: string[]) =>
  feedback({
    skills: {
      score: 70,
      description: '',
      matchedSkills: evidence.map((text, i) => ({
        name: `Skill ${i}`,
        evidence: text,
      })),
      actionPlan: [],
    },
  });

/** Quotes in the four fields M2c-F added to the check. */
const withAtsArtifacts = (...encodingArtifacts: string[]) =>
  feedback({
    atsCompatibility: {
      description: '',
      encodingArtifacts,
      sectionsDetected: [],
      problems: [],
      fixes: [],
      evidence: [],
    },
  });

const withSectionsDetected = (...sectionsDetected: string[]) =>
  feedback({
    atsCompatibility: {
      description: '',
      encodingArtifacts: [],
      sectionsDetected,
      problems: [],
      fixes: [],
      evidence: [],
    },
  });

const withRequirement = (
  status: 'met' | 'partial' | 'missing',
  requirement: string,
  evidence = '',
) =>
  feedback({
    jobFit: {
      description: '',
      requirements: [{ requirement, kind: 'required', status, evidence, note: '' }],
      strategicRecommendations: [],
    },
  });

const withAchievement = (figure: string, quote: string) =>
  feedback({
    experienceAndImpact: {
      score: 70,
      description: '',
      quantifiedAchievements: [{ figure, quote }],
      strengths: [],
      weaknesses: [],
      suggestedBullets: [],
    },
  });

const withMissingRequirements = (...requirements: string[]) =>
  feedback({
    jobFit: {
      description: '',
      requirements: requirements.map((requirement) => ({
        requirement,
        kind: 'required' as const,
        status: 'missing' as const,
        evidence: '',
        note: '',
      })),
      strategicRecommendations: [],
    },
  });

const withBullet = (...examples: string[]) =>
  feedback({
    experienceAndImpact: {
      score: 70,
      description: '',
      quantifiedAchievements: [
      { figure: '40%', quote: '- Improved deployment reliability, reducing downtime by approximately 40%.' },
    ],
      strengths: [],
      weaknesses: [],
      suggestedBullets: [{ role: 'Backend Engineer', examples }],
    },
  });

describe("checkEvidenceGrounding", () => {
  it("flags a quote fused from two separate bullets", () => {
    // Both halves are in the CV; the sentence is not.
    const violations = checkEvidenceGrounding(
      CV,
      withEvidence("Built backend services using Node.js and Express.js"),
    );

    expect(violations).toEqual([
      expect.objectContaining({
        check: "evidence-grounding",
        path: "skills.matchedSkills[0].evidence",
        value: "Built backend services using Node.js and Express.js",
        // Both halves are real, so it is a stitch, not an invention.
        kind: "altered",
      }),
    ]);
  });

  it("accepts a verbatim quote, and one that differs only in whitespace", () => {
    const violations = checkEvidenceGrounding(
      CV,
      withEvidence("Designed REST APIs with Express.js.", "Docker,   CI/CD,\n Git"),
    );

    expect(violations).toEqual([]);
  });

  it("flags a quote that differs in case or punctuation, and says so", () => {
    const violations = checkEvidenceGrounding(
      CV,
      withEvidence("designed rest apis with express js"),
    );

    expect(violations).toEqual([
      expect.objectContaining({ note: "in the CV except for case or punctuation" }),
    ]);
  });

  it.each([
    // Nothing of it is in the CV: commentary or invention.
    ["not-found", "Listed under Infrastructure and used across both roles"],
    // Every word is there, only the typography differs.
    ["case-or-punctuation", "designed rest apis with express js"],
    // Real fragments, welded into a sentence the CV never says.
    ["altered", "Built backend services using Node.js with Express.js."],
  ] as const)("classifies a %s quote", (kind, quote) => {
    expect(checkEvidenceGrounding(CV, withEvidence(quote))).toEqual([
      expect.objectContaining({ kind }),
    ]);
  });

  it("counts the three kinds separately", () => {
    const violations = checkEvidenceGrounding(
      CV,
      withEvidence(
        "Listed under Infrastructure and used across both roles",
        "designed rest apis with express js",
        "Built backend services using Node.js with Express.js.",
        "Designed REST APIs with Express.js.",
      ),
    );

    expect(countGrounding(violations)).toEqual({
      "not-found": 1,
      "case-or-punctuation": 1,
      altered: 1,
    });
  });

  it("covers the ATS evidence list too", () => {
    const analysis = feedback({
      atsCompatibility: {
        description: "",
        encodingArtifacts: [],
        sectionsDetected: [],
        problems: [],
        fixes: [],
        evidence: ["Senior Director of Everything"],
      },
    });

    expect(checkEvidenceGrounding(CV, analysis)).toEqual([
      expect.objectContaining({ path: "atsCompatibility.evidence[0]" }),
    ]);
  });
  /*
   * M2c-F moved work out of the prompt and into the output shape, which put a
   * quote in four more places. Each one is a place a quote can be invented, so
   * each one is checked.
   */
  it.each([
    [
      'an encoding artifact',
      withAtsArtifacts('Jos´e'),
      'atsCompatibility.encodingArtifacts[0]',
    ],
    [
      'a detected section heading',
      withSectionsDetected('CORE COMPETENCIES'),
      'atsCompatibility.sectionsDetected[0]',
    ],
    [
      'the evidence behind a requirement status',
      withRequirement('met', 'Kubernetes in production', 'Ran Kubernetes clusters'),
      'jobFit.requirements[0].evidence',
    ],
    [
      'the quote behind a quantified achievement',
      withAchievement('80%', 'cut error rates by 80%'),
      'experienceAndImpact.quantifiedAchievements[0].quote',
    ],
  ])('flags %s that is not in the CV', (_label, analysis, path) => {
    expect(checkEvidenceGrounding(CV, analysis)).toEqual([
      expect.objectContaining({ path }),
    ]);
  });

  it.each([
    ['an artifact that is in the CV', withAtsArtifacts('Express.js')],
    ['a heading that is in the CV', withSectionsDetected('EXPERIENCE')],
    [
      'a requirement quote that is in the CV',
      withRequirement('met', 'Node.js', 'Built backend services using Node.js.'),
    ],
    [
      'an achievement quote that is in the CV',
      withAchievement('40%', 'reducing downtime by approximately 40%'),
    ],
  ])('passes %s', (_label, analysis) => {
    expect(checkEvidenceGrounding(CV, analysis)).toEqual([]);
  });

  it('ignores an empty quote, since rule 5 prefers it to a description', () => {
    expect(
      checkEvidenceGrounding(CV, withRequirement('missing', 'Rust', '')),
    ).toEqual([]);
  });
});

describe("checkFalseMissing", () => {
  it("flags a requirement called missing that the CV lists", () => {
    const violations = checkFalseMissing(CV, withMissingRequirements("CI/CD"));

    expect(violations).toEqual([
      expect.objectContaining({
        check: "false-missing",
        path: "jobFit.requirements[0].requirement",
        value: "CI/CD",
      }),
    ]);
  });

  it("ignores a requirement that is met, however it is worded", () => {
    const met = withRequirement("met", "CI/CD", "CI/CD");

    expect(checkFalseMissing(CV, met)).toEqual([]);
  });

  it("flags a missing keyword that appears literally in the CV", () => {
    const analysis = feedback({
      jobFit: {
        description: "",
        requirements: ["Scalability", "Kubernetes"].map((requirement) => ({
          requirement,
          kind: "required" as const,
          status: "missing" as const,
          evidence: "",
          note: "",
        })),
        strategicRecommendations: [],
      },
    });

    expect(checkFalseMissing(CV, analysis)).toEqual([
      expect.objectContaining({
        path: "jobFit.requirements[0].requirement",
        value: "Scalability",
      }),
    ]);
  });

  it("flags a recommended certification the CV already holds", () => {
    const analysis = feedback({
      educationAndCertifications: {
        score: 70,
        description: "",
        highlights: [],
        improvements: [],
        recommendedCerts: ["AWS Certified Developer", "Certified Kubernetes Administrator"],
      },
    });

    expect(checkFalseMissing(CV, analysis)).toEqual([
      expect.objectContaining({ value: "AWS Certified Developer" }),
    ]);
  });

  it("matches items that end in punctuation, such as C# and C++", () => {
    const violations = checkFalseMissing(CV, withMissingRequirements("C#", "C++"));

    // C# is in the CV's skills line; C++ is not.
    expect(violations.map((violation) => violation.value)).toEqual(["C#"]);
  });

  it("does not match inside a longer word", () => {
    // "Go" must not match "Google Cloud".
    expect(checkFalseMissing(CV, withMissingRequirements("Go"))).toEqual([]);
  });

  it("known limitation: a morphological variant is not matched", () => {
    const cv = CV.replace("Scalability", "scalable services");

    expect(checkFalseMissing(cv, withMissingRequirements("Scalability"))).toEqual([]);
  });

  it("known limitation: a sentence-shaped item matches nothing", () => {
    const item = "Kotlin production use is brief compared to Go and Java";

    expect(checkFalseMissing(CV, withMissingRequirements(item))).toEqual([]);
  });
});

describe("checkFabricatedNumbers", () => {
  it("flags a percentage that is nowhere in the CV", () => {
    const violations = checkFabricatedNumbers(
      CV,
      withBullet("Tuned queries, reducing query response times by 35%."),
    );

    expect(violations).toEqual([
      expect.objectContaining({
        check: "fabricated-number",
        path: "experienceAndImpact.suggestedBullets[0].examples[0]",
        value: "35",
      }),
    ]);
  });

  it("accepts a bullet that reuses a number from the CV", () => {
    const violations = checkFabricatedNumbers(
      CV,
      withBullet("Improved reliability, cutting downtime by 40% in 2021."),
    );

    expect(violations).toEqual([]);
  });

  it("flags invented quantities written as words", () => {
    const violations = checkFabricatedNumbers(
      CV,
      withBullet("Handled thousands of requests with zero downtime."),
    );

    expect(violations.map((violation) => violation.value).sort()).toEqual([
      "thousands",
      "zero",
    ]);
  });

  it("reads 1,200 and 1200 as the same number", () => {
    const cv = `${CV}\n- Served 1200 daily users.`;

    expect(checkFabricatedNumbers(cv, withBullet("Served 1,200 daily users."))).toEqual([]);
  });
});

describe("checkAnalysis", () => {
  it("runs every check and counts the violations by kind", () => {
    const analysis = feedback({
      skills: {
        score: 70,
        description: "",
        matchedSkills: [{ name: "Node.js", evidence: "Shipped a Node.js platform" }],
        actionPlan: [],
      },
      jobFit: {
        description: "",
        requirements: [
          {
            requirement: "CI/CD",
            kind: "required" as const,
            status: "missing" as const,
            evidence: "",
            note: "",
          },
        ],
        strategicRecommendations: [],
      },
      experienceAndImpact: {
        score: 70,
        description: "",
        quantifiedAchievements: [
        { figure: '40%', quote: '- Improved deployment reliability, reducing downtime by approximately 40%.' },
    ],
        strengths: [],
        weaknesses: [],
        suggestedBullets: [{ role: "Backend Engineer", examples: ["Cut latency 35%."] }],
      },
    });

    expect(countByCheck(checkAnalysis(CV, analysis))).toEqual({
      "evidence-grounding": 1,
      "false-missing": 1,
      "fabricated-number": 1,
      "missed-figure": 0,
    });
  });

  it("reports nothing on an analysis that stays inside the CV", () => {
    expect(checkAnalysis(CV, feedback())).toEqual([]);
  });
});

describe("checkMissedFigures", () => {
  const withNoAchievements = () =>
    feedback({
      experienceAndImpact: {
        score: 70,
        description: "",
        quantifiedAchievements: [],
        strengths: [],
        weaknesses: [],
        suggestedBullets: [],
      },
    });

  it("fires when the CV states a percentage and the field came back empty", () => {
    // The observed failure: the model missed the CV's only figure, left the
    // field empty, and then said figures were absent - a claim consistent with
    // its own wrong finding, so nothing else caught it.
    expect(checkMissedFigures(CV, withNoAchievements())).toEqual([
      expect.objectContaining({
        check: "missed-figure",
        path: "experienceAndImpact.quantifiedAchievements",
        value: "40%",
      }),
    ]);
  });

  it("says nothing when the model did report an achievement", () => {
    expect(checkMissedFigures(CV, feedback())).toEqual([]);
  });

  it("says nothing when the CV has no outcome figure to miss", () => {
    const plain = CV.replace("by approximately 40%", "noticeably");

    expect(checkMissedFigures(plain, withNoAchievements())).toEqual([]);
  });

  it.each([
    ["a multiplier", "- Cut build times 3x after reworking the pipeline."],
    ["a money amount", "- Saved $40,000 a year in hosting."],
    ["a spaced percentage", "- Raised conversion 12 % in one quarter."],
  ])("recognizes %s as an outcome figure", (_label, line) => {
    expect(checkMissedFigures(`EXPERIENCE\n${line}`, withNoAchievements())).toHaveLength(1);
  });

  it.each([
    ["a year", "- Joined the platform team in 2021 and stayed three years."],
    ["a team size", "- Led 4 engineers across 2 squads."],
    ["a version", "- Migrated the service to Node 20."],
  ])("ignores %s, which is not an outcome", (_label, line) => {
    // Precision over recall: this check only earns its place if it is believed
    // when it fires, and a bare count is usually a date or a headcount.
    expect(checkMissedFigures(`EXPERIENCE\n${line}`, withNoAchievements())).toEqual([]);
  });
});
