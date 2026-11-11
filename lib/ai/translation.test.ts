import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeProvider, reply } from "./client.stub";
import { TRANSLATION_PROMPT_VERSION } from "./prompts/translation.prompt";
import { glossaryFor, protectedTermsOf, translateProse, translationSourceHash } from "./translation";

afterEach(() => vi.unstubAllGlobals());

describe("glossaryFor", () => {
  it("takes the interface's own labels, so prose and page use the same words", () => {
    const glossary = new Map(glossaryFor("es"));
    expect(glossary.get("Not shown in your CV")).toBe("No aparece en tu CV");
    expect(glossary.get("Partly met")).toBe("Cumplido en parte");
    expect(glossary.get("Preferred")).toBe("Deseable");
    expect(glossary.get("Cultural Fit")).toBe("Afinidad cultural");
    expect(glossary.get("gap")).toBe("brecha");
  });
});

describe("protectedTermsOf", () => {
  const feedback = {
    skills: { score: 70, description: "", matchedSkills: [{ name: "PostgreSQL", evidence: "" }], actionPlan: [] },
    jobFit: {
      description: "",
      strategicRecommendations: [],
      requirements: [
        {
          requirement: "",
          kind: "required" as const,
          status: "met" as const,
          evidence: "",
          note: "",
          keyTerms: { mode: "all" as const, terms: [{ term: "Python", cvMatch: "Python" }, { term: "Leadership", cvMatch: "" }, { term: "English", cvMatch: "English" }, { term: "C++", cvMatch: "" }, { term: "web applications", cvMatch: "web apps" }] },
        },
      ],
    },
  };

  it("protects names, not common words or language names", () => {
    const sources = { a: "You list Python and C++ in English for Acme Corp.", b: "Leadership shows in your bullets; web applications and PostgreSQL too." };
    expect(protectedTermsOf(feedback, ["Acme Corp", "Data Analyst"], sources).sort()).toEqual(["Acme Corp", "C++", "PostgreSQL", "Python"].sort());
  });

  it("lists only the terms the strings contain, so the model is never invited to insert one", () => {
    expect(protectedTermsOf(feedback, ["Data Analyst"], { a: "Your CV reads clearly." })).toEqual([]);
  });
});

describe("translationSourceHash", () => {
  it("is stable under key order and changes with the text, the locale's prompt version and the content", () => {
    const a = translationSourceHash({ x: "One.", y: "Two." }, "es");
    expect(translationSourceHash({ y: "Two.", x: "One." }, "es")).toBe(a);
    expect(translationSourceHash({ x: "One!", y: "Two." }, "es")).not.toBe(a);
    expect(TRANSLATION_PROMPT_VERSION).toMatch(/^t\d+$/);
  });
});

describe("translateProse", () => {
  it("sends short ids and the glossary, maps answers back to paths, and keeps only what passes the guards", async () => {
    const provider = installFakeProvider(() =>
      reply.json({ s0: "Tu CV muestra Python durante 3 años.", s1: "Cuantifica la baja del 50% en los incidentes." }),
    );
    const result = await translateProse({
      sources: { "skills.description": "Your CV shows Python for 3 years.", "experienceAndImpact.weaknesses.0": "Quantify the 40% drop in incidents." },
      locale: "es",
      protectedTerms: ["Python"],
    });
    const request = provider.requests[0];
    expect(request.prompt).toContain('"s0": "Your CV shows Python for 3 years."');
    expect(request.prompt).not.toContain("skills.description");
    expect(request.prompt).toContain("Not shown in your CV → No aparece en tu CV");
    expect(request.prompt).toContain("- Python");
    expect(request.system).toContain("Answer with exactly the ids you were given");
    expect(request.temperature).toBe(0);
    expect(request.seed).toBe(7);
    expect(result.kept).toEqual({ "skills.description": "Tu CV muestra Python durante 3 años." });
    expect(result.stats.failures).toEqual([{ path: "experienceAndImpact.weaknesses.0", check: "digits" }]);
  });

  it("throws the client's error when the answer leaves out an id", async () => {
    installFakeProvider(() => reply.json({ s0: "Una." }));
    await expect(translateProse({ sources: { a: "One sentence here.", b: "Another sentence here." }, locale: "es", protectedTerms: [] })).rejects.toMatchObject({
      code: "AI_BAD_FORMAT",
    });
  });
});
