import { describe, expect, it } from "vitest";
import { forcedName, proseNameCandidates, ruleKind, translationTerms } from "./translationTerms";

describe("forcedName", () => {
  it("is a name for a short term with a figure, a symbol or an inner capital", () => {
    for (const name of ["C++", "C#", "Node.js", "CI/CD", "JavaScript", "GitHub", "PostgreSQL", ".NET 8"]) expect(forcedName(name)).toBe(true);
    // A name inside a generic phrase does not make the phrase a name, and capitals alone do not ("AI" is "IA").
    for (const term of ["React", "AI", "SQL", "software architecture", "AI-powered tools", "LinkedIn Profile", "CI/CD Pipeline Context", "experience with 5+ years of Python services"]) {
      expect(forcedName(term)).toBe(false);
    }
  });
});

describe("ruleKind (the M9 rule, for comparison)", () => {
  it("calls a capital past the first letter a name, which misreads generic phrases", () => {
    expect(ruleKind("AI-powered tools", [])).toBe("name");
    expect(ruleKind("scalability", [])).toBe("concept");
    expect(ruleKind("English", ["Write in English."])).toBe("concept");
  });
});

describe("proseNameCandidates", () => {
  it("finds capitalized runs mid-sentence, joined by of/on, and never across a sentence end", () => {
    const found = proseNameCandidates({
      a: "Holds a BSc from the University of Leeds. Built services on AWS. To align, add Ruby on Rails work.",
      b: "Strong React skills; you also list Kafka.",
    });
    expect(found).toContain("University of Leeds");
    expect(found).toContain("AWS");
    expect(found).toContain("Ruby on Rails");
    expect(found).toContain("React");
    expect(found).toContain("Kafka");
    expect(found).not.toContain("AWS. To");
    expect(found).not.toContain("Strong React");
    expect(found).not.toContain("To");
  });

  it("skips titles, whose capitals say nothing about names", () => {
    expect(proseNameCandidates({ a: "Add CI/CD Pipeline Context", b: "Highlight Healthcare/Regulated Experience" })).toEqual([]);
  });

  it("skips quoted text, possessives and language names", () => {
    const found = proseNameCandidates({ a: 'Your line "Led the Platform Team" reads well; Microsoft\'s stack uses English and Azure.' });
    expect(found).not.toContain("Led the Platform Team");
    expect(found).toContain("Microsoft");
    expect(found).not.toContain("English");
    expect(found).toContain("Azure");
  });
});

describe("translationTerms", () => {
  it("puts the sentence terms first, then the analysis' words the prose contains", () => {
    const feedback = {
      skills: { score: 70, description: "", matchedSkills: [{ name: "PostgreSQL", evidence: "" }], actionPlan: [] },
      jobFit: {
        description: "",
        strategicRecommendations: [],
        requirements: [{ requirement: "", kind: "required" as const, status: "met" as const, evidence: "", note: "", keyTerms: { mode: "all" as const, terms: [{ term: "Kubernetes", cvMatch: "" }] } }],
      },
    };
    const terms = translationTerms(feedback, ["Acme"], { a: "You use PostgreSQL at Acme." }, ["schema design"]);
    expect(terms[0]).toBe("schema design");
    expect(terms).toEqual(expect.arrayContaining(["PostgreSQL", "Acme"]));
    expect(terms).not.toContain("Kubernetes");
  });
});
