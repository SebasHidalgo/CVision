import { describe, expect, it } from "vitest";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import { analysisProse, feedbackProse, withProse } from "./translatableProse";

const FEEDBACK: ResumeAnalysisFeedback = {
  overall: {
    qualityScore: 70,
    summaryText: "A clear CV with room for figures.",
    headline: [{ key: "allMet" }],
    prioritizedFixes: [{ title: "Add numbers", impact: "High", action: "Put a figure on the migration." }],
  },
  atsCompatibility: {
    description: "The text layer reads cleanly.",
    encodingArtifacts: ["Â·"],
    sectionsDetected: ["Experience", "Education"],
    problems: ["Dates sit in a sidebar."],
    fixes: ["Move the dates beside each role."],
    evidence: ["Experience"],
  },
  experienceAndImpact: {
    score: 60,
    description: "Roles are clear; results are thin.",
    quantifiedAchievements: [{ figure: "40%", quote: "cut incidents by 40%" }],
    strengths: ["Steady progression."],
    weaknesses: ["Few outcomes."],
    suggestedBullets: [{ role: "Backend Developer, Acme", examples: ["Cut incidents by [X]% by adding alerts."] }],
  },
  skills: { score: 70, description: "The stack matches.", matchedSkills: [{ name: "PostgreSQL", evidence: "PostgreSQL, Redis" }], actionPlan: ["Show Kafka in a bullet."] },
  educationAndCertifications: { score: 50, description: "A relevant degree.", highlights: ["Computer science degree."], improvements: ["List the thesis topic."] },
  toneAndClarity: { description: "Direct.", suggestions: ["Start bullets with verbs."] },
  jobFit: {
    description: "Lead with the payments work.",
    outcomes: [{ key: "showsOf", params: { met: { number: 2 }, total: { number: 3 } } }],
    strategicRecommendations: ["Mention on-call in the cover letter."],
    requirements: [
      { requirement: "3+ years of Go", kind: "required", status: "missing", evidence: "", note: "", noteSentences: [{ key: "downgrade" }], sourceQuote: "3+ years of Go" },
      { requirement: "PostgreSQL", kind: "required", status: "met", evidence: "PostgreSQL, Redis", note: "Listed with Redis.", sourceQuote: "PostgreSQL" },
    ],
  },
};

describe("analysisProse", () => {
  it("collects only what the model wrote", () => {
    const prose = analysisProse(FEEDBACK);
    expect(Object.keys(prose)).toEqual([
      "overall.summaryText",
      "overall.prioritizedFixes.0.title",
      "overall.prioritizedFixes.0.action",
      "atsCompatibility.description",
      "atsCompatibility.problems.0",
      "atsCompatibility.fixes.0",
      "experienceAndImpact.description",
      "experienceAndImpact.strengths.0",
      "experienceAndImpact.weaknesses.0",
      "skills.description",
      "skills.actionPlan.0",
      "educationAndCertifications.description",
      "educationAndCertifications.highlights.0",
      "educationAndCertifications.improvements.0",
      "toneAndClarity.description",
      "toneAndClarity.suggestions.0",
      "jobFit.description",
      "jobFit.strategicRecommendations.0",
      "jobFit.requirements.1.note",
    ]);
  });

  it("never sends quotes, posting lines, names, figures, artifacts, bullets or code-made notes", () => {
    const values = Object.values(analysisProse(FEEDBACK)).join("\n");
    for (const kept of ["Â·", "Experience", "cut incidents by 40%", "Cut incidents by [X]%", "Backend Developer, Acme", "PostgreSQL, Redis", "3+ years of Go", "High"]) {
      expect(values).not.toContain(kept);
    }
  });
});

describe("withProse", () => {
  it("writes translations at their paths and ignores a path that no longer holds a string", () => {
    const translated = withProse(FEEDBACK, { "skills.actionPlan.0": "Muestra Kafka en una viñeta.", "skills.actionPlan.5": "nope", "skills.score": "70" });
    expect(translated.skills.actionPlan).toEqual(["Muestra Kafka en una viñeta."]);
    expect(translated.skills.score).toBe(70);
    expect(FEEDBACK.skills.actionPlan).toEqual(["Show Kafka in a bullet."]);
  });
});

describe("feedbackProse", () => {
  it("collects the model's notes, reasons, comments, points and assessment, never quotes or gap names", () => {
    const report = {
      gapFollowThrough: [{ requirement: "Kubernetes", outcome: "dodged", quote: "I have used it a bit", note: "No concrete example." }],
      notableAnswers: [{ quote: "We cut costs by half", worked: true, why: "A figure and an outcome." }],
      categoryScores: [{ name: "Communication Skills", score: 70, comment: "Clear answers." }],
      strengths: [{ point: "Concrete numbers.", anchor: { source: "notableAnswers", index: 0 } }],
      areasForImprovement: [{ point: "Answer the Kubernetes question.", anchor: { source: "gapFollowThrough", index: 0 } }],
      finalAssessment: "Solid, with one dodge.",
    } as unknown as InterviewFeedbackReport;
    const prose = feedbackProse(report);
    expect(Object.keys(prose)).toEqual([
      "gapFollowThrough.0.note",
      "notableAnswers.0.why",
      "categoryScores.0.comment",
      "strengths.0.point",
      "areasForImprovement.0.point",
      "finalAssessment",
    ]);
    expect(Object.values(prose).join("\n")).not.toContain("I have used it a bit");
  });
});
