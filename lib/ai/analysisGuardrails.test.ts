import { describe, expect, it } from "vitest";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import { describeCounts, guardAnalysis } from "./analysisGuardrails";

const CV = [
  "JANE DOE — Backend Engineer",
  "",
  "EXPERIENCE",
  "Northwind, Backend Engineer, 2021 to present",
  "- Built backend services using Node.js.",
  "- Maintainer of 'outboxer', an open-source Go library.",
  "- Improved deployment reliability, reducing downtime by approximately 40%.",
  "",
  "SKILLS",
  "Docker, CI/CD, Git, C#, Java, JavaScript, Scalability",
].join("\n");

function feedback(
  overrides: Partial<ResumeAnalysisFeedback> = {},
): ResumeAnalysisFeedback {
  const section = { score: 70, description: "" };
  return {
    overall: { fitScore: 60, qualityScore: 55, summaryText: "", prioritizedFixes: [] },
    atsCompatibility: {
      description: "",
      encodingArtifacts: [],
      sectionsDetected: [],
      problems: [],
      fixes: [],
      evidence: [],
    },
    experienceAndImpact: {
      ...section,
      quantifiedAchievements: [],
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
    jobFit: { description: "", requirements: [], strategicRecommendations: [] },
    ...overrides,
  };
}

const withSkill = (name: string, evidence: string) =>
  feedback({
    skills: {
      score: 70,
      description: "",
      matchedSkills: [{ name, evidence }],
      actionPlan: [],
    },
  });

const withBullets = (...examples: string[]) =>
  feedback({
    experienceAndImpact: {
      score: 70,
      description: "",
      quantifiedAchievements: [],
      strengths: [],
      weaknesses: [],
      suggestedBullets: [{ role: "Backend Engineer", examples }],
    },
  });

const withRequirement = (status: "met" | "missing", requirement: string) =>
  feedback({
    jobFit: {
      description: "",
      requirements: [
        { requirement, kind: "required", status, evidence: "", note: "" },
      ],
      strategicRecommendations: [],
    },
  });

describe("a quote that is nowhere in the CV", () => {
  it("drops the quote and keeps the claim", () => {
    const { feedback: clean, guard } = guardAnalysis(
      CV,
      withSkill("Kubernetes", "Ran production Kubernetes clusters for three years"),
    );

    // The fabricated quote is the harm; the matched skill is not.
    expect(clean.skills.matchedSkills).toEqual([
      { name: "Kubernetes", evidence: "" },
    ]);
    expect(guard.counts["quote-dropped"]).toBe(1);
    expect(guard.interventions[0]).toMatchObject({
      check: "evidence-grounding",
      action: "quote-dropped",
      path: "skills.matchedSkills[0].evidence",
    });
  });

  it("drops a quote stitched out of two separate places", () => {
    const stitched = "Built backend services using Node.js. Docker, CI/CD, Git";
    const { feedback: clean, guard } = guardAnalysis(CV, withSkill("Node.js", stitched));

    expect(clean.skills.matchedSkills[0].evidence).toBe("");
    expect(guard.counts["quote-dropped"]).toBe(1);
  });
});

describe("a quote that differs only in case or punctuation", () => {
  it("rewrites it as the CV has it and does not call it a violation", () => {
    // The model straightening 'outboxer' into "outboxer": typography, not
    // invention. Six of seven real cases were exactly this.
    const { feedback: clean, guard } = guardAnalysis(
      CV,
      withSkill("Go", 'Maintainer of "outboxer", an open-source Go library.'),
    );

    expect(clean.skills.matchedSkills[0].evidence).toBe(
      "Maintainer of 'outboxer', an open-source Go library.",
    );
    expect(guard.counts["quote-normalized"]).toBe(1);
    expect(guard.counts["quote-dropped"]).toBe(0);
  });

  it("keeps it visible in the record, so the rate is still measurable", () => {
    const { guard } = guardAnalysis(
      CV,
      withSkill("Node.js", "built backend services using node.js"),
    );

    expect(guard.interventions).toEqual([
      expect.objectContaining({
        action: "quote-normalized",
        replacement: "Built backend services using Node.js.",
      }),
    ]);
    // Still one violation: cleaning it must not erase that it happened.
    expect(guard.violations).toHaveLength(1);
  });
});

describe("an invented number in a suggested bullet", () => {
  it("becomes the placeholder the prompt already asks for, bullet intact", () => {
    const { feedback: clean, guard } = guardAnalysis(
      CV,
      withBullets("Tuned queries, cutting response time by 35%."),
    );

    expect(clean.experienceAndImpact.suggestedBullets[0].examples).toEqual([
      "Tuned queries, cutting response time by [X]%.",
    ]);
    expect(guard.counts["number-placeheld"]).toBe(1);
  });

  it("uses [N] for a bare count and [$X] for money", () => {
    const { feedback: clean } = guardAnalysis(
      CV,
      withBullets("Served 1,200 daily users.", "Cut spend by $45,000."),
    );

    expect(clean.experienceAndImpact.suggestedBullets[0].examples).toEqual([
      "Served [N] daily users.",
      "Cut spend by [$X].",
    ]);
  });

  it("keeps a figure the CV does have", () => {
    const { feedback: clean, guard } = guardAnalysis(
      CV,
      withBullets("Cut downtime by 40% during the rollout."),
    );

    expect(clean.experienceAndImpact.suggestedBullets[0].examples).toEqual([
      "Cut downtime by 40% during the rollout.",
    ]);
    expect(describeCounts(guard.counts)).toBe("");
  });

  it("drops the bullet when the quantity is a word, which has no placeholder", () => {
    const { feedback: clean, guard } = guardAnalysis(
      CV,
      withBullets("Ran migrations with zero downtime.", "Built services in Node.js."),
    );

    // "[N] downtime" is not a sentence, so there is no clean substitution.
    expect(clean.experienceAndImpact.suggestedBullets[0].examples).toEqual([
      "Built services in Node.js.",
    ]);
    expect(guard.counts["bullet-dropped"]).toBe(1);
    expect(guard.interventions[0]).toMatchObject({
      action: "bullet-dropped",
      value: "zero",
    });
  });

  it("removes a role whose every example was dropped", () => {
    const { feedback: clean } = guardAnalysis(
      CV,
      withBullets("Scaled to thousands of users."),
    );

    expect(clean.experienceAndImpact.suggestedBullets).toEqual([]);
  });
});

describe("a requirement called missing that the CV mentions", () => {
  it("is recorded and left alone, because flipping a status is a bigger call", () => {
    const { feedback: clean, guard } = guardAnalysis(
      CV,
      withRequirement("missing", "Docker"),
    );

    expect(clean.jobFit.requirements[0].status).toBe("missing");
    expect(guard.counts.recorded).toBe(1);
    expect(guard.interventions).toEqual([
      expect.objectContaining({ check: "false-missing", action: "recorded" }),
    ]);
  });
});

describe("the measurement the guardrail must not destroy", () => {
  it("reports the violations as the checks found them, before any edit", () => {
    const analysis = feedback({
      skills: {
        score: 70,
        description: "",
        matchedSkills: [{ name: "Kubernetes", evidence: "Ran Kubernetes in anger" }],
        actionPlan: [],
      },
      experienceAndImpact: {
        score: 70,
        description: "",
        quantifiedAchievements: [],
        strengths: [],
        weaknesses: [],
        suggestedBullets: [{ role: "Engineer", examples: ["Cut latency 35%."] }],
      },
    });

    const { guard } = guardAnalysis(CV, analysis);

    // Two violations found, two interventions taken, and the violations are
    // still there to count. A guardrail that zeroed this would cost us the
    // only signal we have about the model drifting.
    expect(guard.violations).toHaveLength(2);
    expect(guard.interventions).toHaveLength(2);
    expect(describeCounts(guard.counts)).toBe("quote-dropped 1, number-placeheld 1");
  });

  it("never mutates what the model returned", () => {
    const analysis = withSkill("Kubernetes", "Ran production Kubernetes clusters");
    const before = structuredClone(analysis);

    guardAnalysis(CV, analysis);

    expect(analysis).toEqual(before);
  });

  it("says nothing when the analysis is clean", () => {
    const { guard } = guardAnalysis(
      CV,
      withSkill("Node.js", "Built backend services using Node.js."),
    );

    expect(guard.violations).toEqual([]);
    expect(guard.interventions).toEqual([]);
    expect(describeCounts(guard.counts)).toBe("");
  });
});
