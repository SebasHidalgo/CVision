import { describe, expect, it } from "vitest";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import {
  checkAnalysis,
  checkEvidenceGrounding,
  checkFabricatedNumbers,
  checkFalseMissing,
  countByCheck,
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
  const section = { score: 70, description: "" };
  return {
    overall: {
      globalScore: 70,
      verdict: "Good",
      summaryText: "",
      prioritizedFixes: [],
    },
    atsCompatibility: { ...section, problems: [], fixes: [], evidence: [] },
    experienceAndImpact: {
      ...section,
      strengths: [],
      weaknesses: [],
      suggestedBullets: [],
    },
    skills: {
      ...section,
      matchedSkills: [],
      missingSkills: [],
      actionPlan: [],
    },
    educationAndCertifications: {
      ...section,
      highlights: [],
      improvements: [],
      recommendedCerts: [],
    },
    toneAndClarity: { ...section, readability: 60, suggestions: [] },
    jobFit: {
      ...section,
      matchedKeywords: [],
      missingKeywords: [],
      strategicRecommendations: [],
    },
    ...overrides,
  };
}

const withEvidence = (...evidence: string[]) =>
  feedback({
    skills: {
      score: 70,
      description: "",
      matchedSkills: evidence.map((text, i) => ({
        name: `Skill ${i}`,
        evidence: text,
      })),
      missingSkills: [],
      actionPlan: [],
    },
  });

const withMissingSkills = (...missingSkills: string[]) =>
  feedback({
    skills: { score: 70, description: "", matchedSkills: [], missingSkills, actionPlan: [] },
  });

const withBullet = (...examples: string[]) =>
  feedback({
    experienceAndImpact: {
      score: 70,
      description: "",
      strengths: [],
      weaknesses: [],
      suggestedBullets: [{ role: "Backend Engineer", examples }],
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
        note: undefined,
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

  it("covers the ATS evidence list too", () => {
    const analysis = feedback({
      atsCompatibility: {
        score: 70,
        description: "",
        problems: [],
        fixes: [],
        evidence: ["Senior Director of Everything"],
      },
    });

    expect(checkEvidenceGrounding(CV, analysis)).toEqual([
      expect.objectContaining({ path: "atsCompatibility.evidence[0]" }),
    ]);
  });
});

describe("checkFalseMissing", () => {
  it("flags a skill the CV lists in its skills section", () => {
    const violations = checkFalseMissing(CV, withMissingSkills("CI/CD"));

    expect(violations).toEqual([
      expect.objectContaining({
        check: "false-missing",
        path: "skills.missingSkills[0]",
        value: "CI/CD",
      }),
    ]);
  });

  it("flags a missing keyword that appears literally in the CV", () => {
    const analysis = feedback({
      jobFit: {
        score: 70,
        description: "",
        matchedKeywords: [],
        missingKeywords: ["Scalability", "Kubernetes"],
        strategicRecommendations: [],
      },
    });

    expect(checkFalseMissing(CV, analysis)).toEqual([
      expect.objectContaining({ path: "jobFit.missingKeywords[0]", value: "Scalability" }),
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
    const violations = checkFalseMissing(CV, withMissingSkills("C#", "C++"));

    // C# is in the CV's skills line; C++ is not.
    expect(violations.map((violation) => violation.value)).toEqual(["C#"]);
  });

  it("does not match inside a longer word", () => {
    // "Go" must not match "Google Cloud".
    expect(checkFalseMissing(CV, withMissingSkills("Go"))).toEqual([]);
  });

  it("known limitation: a morphological variant is not matched", () => {
    const cv = CV.replace("Scalability", "scalable services");

    expect(checkFalseMissing(cv, withMissingSkills("Scalability"))).toEqual([]);
  });

  it("known limitation: a sentence-shaped item matches nothing", () => {
    const item = "Kotlin production use is brief compared to Go and Java";

    expect(checkFalseMissing(CV, withMissingSkills(item))).toEqual([]);
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
        missingSkills: ["CI/CD"],
        actionPlan: [],
      },
      experienceAndImpact: {
        score: 70,
        description: "",
        strengths: [],
        weaknesses: [],
        suggestedBullets: [{ role: "Backend Engineer", examples: ["Cut latency 35%."] }],
      },
    });

    expect(countByCheck(checkAnalysis(CV, analysis))).toEqual({
      "evidence-grounding": 1,
      "false-missing": 1,
      "fabricated-number": 1,
    });
  });

  it("reports nothing on an analysis that stays inside the CV", () => {
    expect(checkAnalysis(CV, feedback())).toEqual([]);
  });
});
