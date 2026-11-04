import { describe, expect, it } from "vitest";
import type { ModelRequirement, Requirement, ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import {
  alignToSource,
  clauseAsRequirement,
  DOWNGRADE_NOTE,
  enforceRequirementStatuses,
  evidenceSourceOf,
  guardMatchedSkills,
  headingKind,
  requirementHeadline,
  structureRequirements,
  unshowableAlternativeIn,
  withEvidenceSources,
  withoutClause,
} from "./requirementGuardrails";

const POSTING = `Data Analyst

What you will do
- Write SQL to answer business questions and automate recurring reports.
- Run our Kubernetes clusters, so you have operated Kubernetes in production before.

Requirements
- 3+ years of experience as a data or business analyst, ideally in e-commerce or retail.
- Fluent English; another European language is a plus.
- Nice extras are a plus.

Our stack is BigQuery, dbt and Looker.`;

const NO_CLAUSE = { quote: "", status: "missing" as const, evidence: "", note: "" };

const entry = (overrides: Partial<ModelRequirement>): ModelRequirement => ({
  sourceQuote: "3+ years of experience as a data or business analyst",
  heading: "Requirements",
  section: "requirements",
  demandsCapability: true,
  requirement: "3+ years as a data or business analyst",
  kind: "required",
  softenedClause: NO_CLAUSE,
  assessable: true,
  status: "met",
  evidence: "Data Analyst, 2019 - present",
  note: "",
  keyTerms: { mode: "all", terms: [] },
  unshowableAlternative: "",
  yearsEvidence: [],
  ...overrides,
});

describe("structureRequirements: the posting quote", () => {
  it("keeps a verbatim quote, rewrites one that differs only in case, and drops one that is not in the posting", () => {
    const { requirements, interventions } = structureRequirements(POSTING, [
      entry({}),
      entry({ sourceQuote: "FLUENT ENGLISH", requirement: "Fluent English" }),
      entry({ sourceQuote: "A degree in statistics", requirement: "Degree in statistics" }),
      entry({ sourceQuote: "", requirement: "Something" }),
    ]);

    // The span as the posting writes it, word-aligned, so its own semicolon comes along.
    expect(requirements.map((one) => one.sourceQuote)).toEqual([
      "3+ years of experience as a data or business analyst",
      "Fluent English;",
    ]);
    expect(interventions.map((one) => [one.check, one.action, one.value])).toEqual([
      ["posting-source", "quote-normalized", "FLUENT ENGLISH"],
      ["posting-source", "requirement-dropped", "Degree in statistics"],
      ["posting-source", "requirement-dropped", "Something"],
    ]);
  });
});

describe("structureRequirements: the section", () => {
  it("drops the description and a responsibility that demands nothing, and keeps one that does", () => {
    const { requirements, interventions } = structureRequirements(POSTING, [
      entry({ sourceQuote: "Our stack is BigQuery, dbt and Looker.", section: "description", requirement: "BigQuery" }),
      entry({ sourceQuote: "Write SQL to answer business questions", section: "responsibilities", demandsCapability: false, requirement: "SQL" }),
      entry({ sourceQuote: "so you have operated Kubernetes in production before", section: "responsibilities", requirement: "Kubernetes in production" }),
    ]);

    expect(requirements.map((one) => [one.requirement, one.section])).toEqual([["Kubernetes in production", "responsibilities"]]);
    expect(interventions.map((one) => [one.check, one.action, one.replacement])).toEqual([
      ["posting-section", "requirement-dropped", "description"],
      ["posting-section", "requirement-dropped", "responsibilities"],
    ]);
  });
});

describe("structureRequirements: the softened clause", () => {
  it("turns it into a preferred requirement of its own and trims it from the required one", () => {
    const { requirements, interventions } = structureRequirements(POSTING, [
      entry({
        sourceQuote: "3+ years of experience as a data or business analyst, ideally in e-commerce or retail.",
        requirement: "3+ years as a data or business analyst, ideally in e-commerce or retail",
        softenedClause: { quote: "ideally in e-commerce or retail", status: "met", evidence: "Zalando", note: "Two years at Zalando." },
      }),
    ]);

    expect(requirements).toEqual([
      expect.objectContaining({
        requirement: "3+ years as a data or business analyst",
        kind: "required",
        sourceQuote: "3+ years of experience as a data or business analyst",
      }),
      expect.objectContaining({
        requirement: "Ideally in e-commerce or retail",
        kind: "preferred",
        status: "met",
        evidence: "Zalando",
        note: "Two years at Zalando.",
        sourceQuote: "ideally in e-commerce or retail",
      }),
    ]);
    expect(interventions).toEqual([
      expect.objectContaining({ check: "softened-clause", action: "requirement-split", replacement: "Ideally in e-commerce or retail" }),
    ]);
  });

  it("makes the whole entry preferred when the softened part is all of it", () => {
    const { requirements, interventions } = structureRequirements(POSTING, [
      entry({ sourceQuote: "Nice extras are a plus.", requirement: "Nice extras", softenedClause: { ...NO_CLAUSE, quote: "Nice extras are a plus." } }),
    ]);

    expect(requirements.map((one) => one.kind)).toEqual(["preferred"]);
    expect(interventions[0]).toMatchObject({ action: "kind-changed" });
  });

  it("records a clause that is not in the posting, and adds nothing", () => {
    const { requirements, interventions } = structureRequirements(POSTING, [
      entry({ softenedClause: { ...NO_CLAUSE, quote: "ideally in fintech" } }),
    ]);

    expect(requirements).toHaveLength(1);
    expect(interventions[0]).toMatchObject({ check: "softened-clause", action: "recorded", replacement: "not in posting" });
  });

  it("ignores an example, an alternative or a remark the model mistook for a softened clause", () => {
    const posting = `${POSTING}
- Strong SQL; experience with a cloud warehouse such as BigQuery or Snowflake.
- Experience with GraphQL schema design, or a clear appetite to learn it fast.`;
    const { requirements, interventions } = structureRequirements(posting, [
      entry({ sourceQuote: "experience with a cloud warehouse such as BigQuery or Snowflake.", softenedClause: { ...NO_CLAUSE, quote: "such as BigQuery or Snowflake" } }),
      entry({ sourceQuote: "Experience with GraphQL schema design, or a clear appetite to learn it fast.", softenedClause: { ...NO_CLAUSE, quote: "or a clear appetite to learn it fast" } }),
    ]);

    expect(requirements).toHaveLength(2);
    expect(interventions.map((one) => one.replacement)).toEqual(["no softening word", "no softening word"]);
  });

  it("does not add a clause the model already listed as a preferred entry, but still trims it", () => {
    const { requirements } = structureRequirements(POSTING, [
      entry({
        sourceQuote: "Fluent English; another European language is a plus.",
        requirement: "Fluent English; another European language is a plus",
        softenedClause: { ...NO_CLAUSE, quote: "another European language is a plus" },
      }),
      entry({ sourceQuote: "another European language is a plus", requirement: "Another European language", kind: "preferred" }),
    ]);

    expect(requirements.map((one) => [one.requirement, one.kind])).toEqual([
      ["Fluent English", "required"],
      ["Another European language", "preferred"],
    ]);
  });

  it("ignores a softened clause on a preferred entry", () => {
    const { requirements, interventions } = structureRequirements(POSTING, [
      entry({ kind: "preferred", heading: "", section: "preferred", softenedClause: { ...NO_CLAUSE, quote: "ideally in e-commerce or retail" } }),
    ]);

    expect(requirements).toHaveLength(1);
    expect(interventions).toEqual([]);
  });
});

describe("withoutClause and clauseAsRequirement", () => {
  it("cuts the clause and the separators it leaves", () => {
    expect(withoutClause("Fluent English; another European language is a plus.", "another European language is a plus")).toBe("Fluent English");
    expect(withoutClause("Experiencia con una herramienta de BI, preferiblemente Power BI o Looker.", "preferiblemente Power BI o Looker")).toBe(
      "Experiencia con una herramienta de BI",
    );
    expect(withoutClause("Strong SQL", "ideally BigQuery")).toBeNull();
    expect(withoutClause("ideally BigQuery", "ideally BigQuery")).toBeNull();
  });

  it("reads the clause as a requirement line", () => {
    expect(clauseAsRequirement(", ideally in e-commerce.")).toBe("Ideally in e-commerce");
    expect(clauseAsRequirement("preferiblemente Power BI")).toBe("Preferiblemente Power BI");
  });
});

describe("enforceRequirementStatuses", () => {
  const stored = (overrides: Partial<Requirement>): Requirement => ({
    requirement: "Something",
    kind: "required",
    status: "met",
    evidence: "a line",
    note: "the model's note",
    assessable: true,
    ...overrides,
  });

  it("downgrades met or partial without evidence: to missing when a CV could show it, to not_evident when it could not", () => {
    const { requirements, interventions } = enforceRequirementStatuses([
      stored({ evidence: "" }),
      stored({ status: "partial", evidence: "  " }),
      stored({ evidence: "", assessable: false }),
      stored({}),
    ]);

    expect(requirements.map((one) => one.status)).toEqual(["missing", "missing", "not_evident", "met"]);
    expect(requirements[0].note).toBe(DOWNGRADE_NOTE);
    expect(requirements[3].note).toBe("the model's note");
    expect(interventions.map((one) => [one.check, one.action, one.replacement])).toEqual([
      ["met-without-evidence", "status-downgraded", "missing"],
      ["met-without-evidence", "status-downgraded", "missing"],
      ["met-without-evidence", "status-downgraded", "not_evident"],
    ]);
  });

  it("allows not_evident only where a CV cannot show the thing, and never calls such a thing missing", () => {
    const { requirements, interventions } = enforceRequirementStatuses([
      stored({ status: "not_evident", evidence: "" }),
      stored({ status: "missing", evidence: "", assessable: false }),
      stored({ status: "not_evident", evidence: "", assessable: false }),
      stored({ status: "met", evidence: "Irish citizen", assessable: false }),
    ]);

    expect(requirements.map((one) => one.status)).toEqual(["missing", "not_evident", "not_evident", "met"]);
    expect(interventions.map((one) => [one.check, one.action, one.replacement])).toEqual([
      ["not-evident", "status-coerced", "missing"],
      ["not-evident", "status-coerced", "not_evident"],
    ]);
  });

  it("reads a stored requirement without the field as assessable", () => {
    const { requirements } = enforceRequirementStatuses([{ requirement: "x", kind: "required", status: "met", evidence: "", note: "" }]);

    expect(requirements[0].status).toBe("missing");
  });
});

// M8-C: the Encora posting the owner analysed, cut to what the rules need.
const ENCORA = `Responsibilities and Duties

* Build and enhance frontend components using React to deliver seamless user experiences

Qualifications and Skills

* 5+ years of experience in full stack software development
* Strong expertise in Ruby on Rails and MySQL for backend development
* Experience working with tools such as Redis, Elasticsearch, and Sidekiq
* Intermediate experience with Python or willingness to learn and work with it
* Familiarity with TypeScript is a plus
* Experience with a BI tool, preferably Power BI or Looker.`;

const CV = `Summary
Full-Stack Developer with 2+ years of experience building scalable web applications.
Experience
Full-Stack Developer July 2024 – November 2024
• Designed and developed a full-stack web platform using the MERN stack (MongoDB, Express.js, React, Node.js) to
manage pet adoption.
Technical Skills
Frontend development: React, Next.js
Databases: MongoDB, PostgreSQL, MySQL`;

const NOW = new Date("2026-11-04T00:00:00Z");
const terms = (mode: "all" | "any", ...pairs: [string, string][]) => ({ mode, terms: pairs.map(([term, cvMatch]) => ({ term, cvMatch })) });

describe("structureRequirements: kind from the posting's own wording", () => {
  it("makes a plain bullet under a qualifications heading required, and keeps a softened one preferred", () => {
    const { requirements, interventions } = structureRequirements(ENCORA, [
      entry({ sourceQuote: "Experience working with tools such as Redis, Elasticsearch, and Sidekiq", heading: "Qualifications and Skills", requirement: "Redis, Elasticsearch, Sidekiq", kind: "preferred" }),
      entry({ sourceQuote: "Familiarity with TypeScript is a plus", heading: "Qualifications and Skills", requirement: "TypeScript", kind: "preferred" }),
    ]);

    expect(requirements.map((one) => one.kind)).toEqual(["required", "preferred"]);
    expect(interventions).toEqual([expect.objectContaining({ check: "posting-kind", action: "kind-changed", replacement: "required" })]);
  });

  it("ignores a heading that comes after the quote", () => {
    const { requirements } = structureRequirements(ENCORA, [
      entry({ sourceQuote: "Build and enhance frontend components using React", heading: "Qualifications and Skills", section: "responsibilities", demandsCapability: true, requirement: "React", kind: "preferred" }),
    ]);

    expect(requirements[0].kind).toBe("preferred");
  });

  it("reads headings", () => {
    expect(headingKind("Qualifications and Skills")).toBe("required");
    expect(headingKind("Preferred/Additional Qualifications")).toBe("preferred");
    expect(headingKind("Nice to have")).toBe("preferred");
    expect(headingKind("Valoramos")).toBe("preferred");
    expect(headingKind("Requisitos")).toBe("required");
    expect(headingKind("About Encora")).toBeNull();
  });
});

describe("structureRequirements: key terms", () => {
  it("drops a term that is not in the quote and gives the softened clause its own terms", () => {
    const { requirements, interventions } = structureRequirements(ENCORA, [
      entry({
        sourceQuote: "Experience with a BI tool, preferably Power BI or Looker.",
        heading: "Qualifications and Skills",
        requirement: "Experience with a BI tool, preferably Power BI or Looker",
        softenedClause: { ...NO_CLAUSE, quote: "preferably Power BI or Looker" },
        keyTerms: terms("any", ["BI tool", "Power BI"], ["Power BI", "Power BI"], ["Looker", ""], ["Tableau", ""]),
      }),
    ]);

    expect(requirements.map((one) => [one.requirement, one.keyTerms])).toEqual([
      ["Experience with a BI tool", terms("any", ["BI tool", "Power BI"])],
      ["Preferably Power BI or Looker", terms("any", ["Power BI", "Power BI"], ["Looker", ""])],
    ]);
    expect(interventions).toContainEqual(expect.objectContaining({ check: "key-term", action: "term-dropped", value: "Tableau" }));
  });
});

describe("structureRequirements: the requirement keeps the posting's spelling and language", () => {
  it("respells a word the model changed and replaces a translation with the posting's words", () => {
    expect(alignToSource("Português", "Portugués.")).toBe("Portugués");
    expect(alignToSource("At least 4 years as a data or business analyst", "Al menos 4 años de experiencia como analista de datos o de negocio.")).toBe(
      "Al menos 4 años de experiencia como analista de datos o de negocio",
    );
    expect(alignToSource("Experience leading support teams", "The person we hire has led a support team")).toBe("Experience leading support teams");
  });
});

describe("enforceRequirementStatuses: key-term coverage", () => {
  const stored = (overrides: Partial<Requirement>): Requirement => ({
    requirement: "Something",
    kind: "required",
    status: "met",
    evidence: "Databases: MongoDB, PostgreSQL, MySQL",
    note: "the model's note",
    assessable: true,
    sourceQuote: "Strong expertise in Ruby on Rails and MySQL for backend development",
    ...overrides,
  });
  const context = (count: number) => ({ pending: Array.from({ length: count }, () => ({ alternative: "", yearsEvidence: [] })), cvText: CV, now: NOW });

  it("caps an 'all' requirement at partial when some terms are shown, at missing when none is", () => {
    const { requirements, interventions } = enforceRequirementStatuses(
      [
        stored({ keyTerms: terms("all", ["Ruby on Rails", ""], ["MySQL", "MySQL"]) }),
        stored({ keyTerms: terms("all", ["Ruby on Rails", ""], ["MySQL", ""]) }),
        stored({ keyTerms: terms("all", ["MySQL", "MySQL"]) }),
      ],
      context(3),
    );

    expect(requirements.map((one) => one.status)).toEqual(["partial", "missing", "met"]);
    expect(requirements[0].note).toBe("Your CV shows MySQL but not Ruby on Rails.");
    expect(interventions.filter((one) => one.action === "status-capped").map((one) => one.replacement)).toEqual(["partial", "missing"]);
  });

  it("allows an 'any' requirement once one term is shown, and empties a CV match the CV does not have", () => {
    const { requirements, interventions } = enforceRequirementStatuses(
      [
        stored({ sourceQuote: "tools such as Redis, Elasticsearch, and Sidekiq", keyTerms: terms("any", ["Redis", "Redis"], ["Elasticsearch", ""]) }),
        stored({ sourceQuote: "tools such as Redis, Elasticsearch, and Sidekiq", keyTerms: terms("any", ["Redis", ""], ["MySQL", "MySQL"]) }),
      ],
      context(2),
    );

    expect(requirements.map((one) => one.status)).toEqual(["missing", "met"]);
    expect(requirements[0].keyTerms?.terms[0].cvMatch).toBe("");
    expect(requirements[0].note).toBe("Your CV doesn't show any of Redis or Elasticsearch.");
    expect(interventions).toContainEqual(expect.objectContaining({ check: "key-term", action: "match-dropped", value: "Redis: Redis" }));
  });

  it("leaves a requirement without terms to the model and the evidence rule", () => {
    const { requirements } = enforceRequirementStatuses([stored({ keyTerms: undefined })], context(1));
    expect(requirements[0].status).toBe("met");
  });
});

describe("enforceRequirementStatuses: years", () => {
  const stored = (overrides: Partial<Requirement>): Requirement => ({
    requirement: "5+ years of experience in full stack software development",
    kind: "required",
    status: "partial",
    evidence: "Full-Stack Developer with 2+ years of experience building scalable web applications.",
    note: "the model's note",
    assessable: true,
    sourceQuote: "5+ years of experience in full stack software development",
    ...overrides,
  });
  const run = (requirement: Requirement, yearsEvidence: string[] = []) =>
    enforceRequirementStatuses([requirement], { pending: [{ alternative: "", yearsEvidence }], cvText: CV, now: NOW });

  it("calls 2 of 5 years missing and says both numbers", () => {
    const { requirements, interventions } = run(stored({}));

    expect(requirements[0]).toMatchObject({ status: "missing", years: { min: 5, candidate: 2, source: "statement" }, note: "The posting asks for 5+ years; your CV shows about 2." });
    expect(interventions[0]).toMatchObject({ check: "years", action: "status-capped", replacement: "missing" });
  });

  it("raises a partial the numbers support, and quotes the years line when the evidence was empty", () => {
    const { requirements } = run(stored({ sourceQuote: "1+ year(s) technical engineering experience", status: "partial", evidence: "" }), ["Full-Stack Developer with 2+ years of experience building scalable web applications."]);

    expect(requirements[0]).toMatchObject({ status: "met", years: { min: 1, candidate: 2 } });
    expect(requirements[0].evidence).toContain("2+ years");
  });

  it("never raises a missing: the model may have ruled the quoted years irrelevant", () => {
    const { requirements } = run(stored({ sourceQuote: "1+ year(s) of professional embedded C development", status: "missing", evidence: "" }), ["Full-Stack Developer with 2+ years of experience building scalable web applications."]);

    expect(requirements[0]).toMatchObject({ status: "missing", years: { min: 1, candidate: 2 } });
  });

  it("still lets key terms cap what the years allow", () => {
    const { requirements } = run(stored({ sourceQuote: "1+ year(s) of Ruby on Rails", keyTerms: terms("all", ["Ruby on Rails", ""]) }));
    expect(requirements[0].status).toBe("missing");
  });

  it("records a minimum it cannot compare with anything", () => {
    const { requirements, interventions } = run(stored({ evidence: "Built REST APIs in Node.js" }));

    expect(requirements[0].status).toBe("partial");
    expect(interventions).toContainEqual(expect.objectContaining({ check: "years", action: "recorded", replacement: "undetermined" }));
  });
});

describe("enforceRequirementStatuses: an alternative a CV cannot show", () => {
  it.each([
    ["Intermediate experience with Python or willingness to learn and work with it", "or willingness to learn and work with it"],
    ["Experience with GraphQL schema design, or a clear appetite to learn it fast.", "or a clear appetite to learn it fast"],
    ["Conocimientos de Airflow o disposición para aprenderlo.", "o disposición para aprenderlo"],
    ["Kotlin, or eagerness to pick it up", "or eagerness to pick it up"],
  ])("finds it in %s", (quote, alternative) => {
    expect(unshowableAlternativeIn(quote)).toBe(alternative);
  });

  it.each([
    "Bachelor’s degree in Computer Science, Software Engineering, or a related field, or equivalent practical experience",
    "You pick up one existing service, learn its failure modes on call",
    "Must be willing to travel to client sites",
    "Continuously seeks new knowledge, adapts to emerging technologies",
  ])("finds none in %s", (quote) => {
    expect(unshowableAlternativeIn(quote)).toBeNull();
  });

  it("turns missing into not_evident with a note naming what is absent, and leaves met alone", () => {
    const python = "Intermediate experience with Python or willingness to learn and work with it";
    const { requirements, interventions } = enforceRequirementStatuses(
      [
        { requirement: python, kind: "required", status: "missing", evidence: "", note: "Python is absent", assessable: true, sourceQuote: python, keyTerms: terms("any", ["Python", ""]) },
        { requirement: python, kind: "required", status: "met", evidence: "Python (pandas)", note: "", assessable: true, sourceQuote: python, keyTerms: terms("any", ["Python", "Python"]) },
      ],
      { pending: [{ alternative: "", yearsEvidence: [] }, { alternative: "", yearsEvidence: [] }], cvText: `${CV}\nPython (pandas)`, now: NOW },
    );

    expect(requirements.map((one) => [one.status, one.assessable])).toEqual([["not_evident", false], ["met", false]]);
    expect(requirements[0].note).toBe("Python isn't in your CV; the posting accepts willingness to learn and work with it — say so in your cover letter.");
    expect(interventions).toContainEqual(expect.objectContaining({ check: "unshowable-alternative", action: "recorded", replacement: "pattern" }));
  });

  it("takes the model's field when the pattern misses, as long as it is in the quote", () => {
    const quote = "Rust, or a demonstrated drive to master it quickly";
    const { requirements, interventions } = enforceRequirementStatuses(
      [{ requirement: "Rust", kind: "required", status: "missing", evidence: "", note: "", assessable: true, sourceQuote: quote }],
      { pending: [{ alternative: "or a demonstrated drive to master it quickly", yearsEvidence: [] }], cvText: CV, now: NOW },
    );

    expect(requirements[0].status).toBe("not_evident");
    expect(interventions).toContainEqual(expect.objectContaining({ check: "unshowable-alternative", replacement: "model" }));
  });

  it("writes its own note when the model chose not_evident itself, and drops a quote that showed nothing", () => {
    const python = "Intermediate experience with Python or willingness to learn and work with it";
    const { requirements } = enforceRequirementStatuses(
      [{ requirement: python, kind: "required", status: "not_evident", evidence: "Databases: MongoDB, PostgreSQL, MySQL", note: "the unshowable alternative covers it", assessable: false, sourceQuote: python, keyTerms: terms("any", ["Python", ""]) }],
      { pending: [{ alternative: "", yearsEvidence: [] }], cvText: CV, now: NOW },
    );

    expect(requirements[0]).toMatchObject({
      status: "not_evident",
      evidence: "",
      note: "Python isn't in your CV; the posting accepts willingness to learn and work with it — say so in your cover letter.",
    });
  });
});

describe("evidenceSourceOf", () => {
  const headings = ["Summary", "Experience", "Technical Skills"];

  it("places a quote in the section above it, a wrapped bullet included", () => {
    expect(evidenceSourceOf(CV, "Frontend development: React, Next.js", headings)).toBe("skills");
    expect(evidenceSourceOf(CV, "• Designed and developed a full-stack web platform using the MERN stack (MongoDB, Express.js, React, Node.js) to manage pet adoption.", headings)).toBe("experience");
    expect(evidenceSourceOf(CV, "Full-Stack Developer with 2+ years of experience", headings)).toBe("summary");
    expect(evidenceSourceOf(CV, "Not in the CV at all", headings)).toBe("other");
  });

  it("knows common headings without sectionsDetected", () => {
    expect(evidenceSourceOf(CV, "Databases: MongoDB, PostgreSQL, MySQL", [])).toBe("skills");
  });
});

describe("requirementHeadline", () => {
  const req = (overrides: Partial<Requirement>): Requirement => ({ requirement: "x", kind: "required", status: "met", evidence: "e", note: "", ...overrides });

  it("names the gaps from the statuses: absent terms, years, short text", () => {
    expect(
      requirementHeadline([
        req({ status: "partial", keyTerms: terms("all", ["Ruby on Rails", ""], ["MySQL", "MySQL"]) }),
        req({ status: "missing", years: { min: 5, candidate: 2, source: "statement" } }),
        req({ status: "missing", keyTerms: terms("any", ["Redis", ""], ["Elasticsearch", ""], ["Sidekiq", ""]) }),
        req({ status: "partial", requirement: "Strong understanding of software architecture" }),
        req({ status: "not_evident", requirement: "Python or willingness" }),
        req({ kind: "preferred", status: "missing", requirement: "TypeScript" }),
      ]),
    ).toBe("Core gaps: Ruby on Rails; 5+ years of experience; Redis, Elasticsearch or Sidekiq. Partly met: Strong understanding of software architecture.");
  });

  it("says so when every required one is met, and says nothing without required ones", () => {
    expect(requirementHeadline([req({}), req({ status: "not_evident" }), req({ kind: "preferred", status: "missing" })])).toBe("You meet every required qualification.");
    expect(requirementHeadline([req({ kind: "preferred" })])).toBe("");
  });
});

describe("guardMatchedSkills", () => {
  it("drops a skill with no quote, or one the CV does not name", () => {
    const feedback = {
      skills: {
        score: 70,
        description: "",
        actionPlan: [],
        matchedSkills: [
          { name: "React", evidence: "Frontend development: React, Next.js" },
          { name: "Redis", evidence: "" },
          { name: "Python", evidence: "Databases: MongoDB, PostgreSQL, MySQL" },
        ],
      },
    } as unknown as ResumeAnalysisFeedback;

    const { feedback: kept, interventions } = guardMatchedSkills(feedback, CV);

    expect(kept.skills.matchedSkills.map((one) => one.name)).toEqual(["React"]);
    expect(interventions.map((one) => [one.value, one.replacement])).toEqual([
      ["Redis", "no evidence"],
      ["Python", "not in the CV"],
    ]);
  });
});

describe("M8-C smoke fixes", () => {
  it("drops a number of years from the key terms, and reads 'and' as all", () => {
    const posting = `${ENCORA}\n* dbt and data contracts.`;
    const { requirements, interventions } = structureRequirements(posting, [
      entry({ sourceQuote: "5+ years of experience in full stack software development", heading: "Qualifications and Skills", requirement: "5+ years", keyTerms: terms("all", ["5+ years of experience", "2+ years of experience"]) }),
      entry({ sourceQuote: "dbt and data contracts.", heading: "Qualifications and Skills", requirement: "dbt and data contracts", keyTerms: terms("any", ["dbt", ""], ["data contracts", "data contracts"]) }),
      entry({ sourceQuote: "Experience working with tools such as Redis, Elasticsearch, and Sidekiq", heading: "Qualifications and Skills", requirement: "Redis", keyTerms: terms("any", ["Redis", ""], ["Sidekiq", ""]) }),
    ]);

    expect(requirements.map((one) => one.keyTerms?.mode ?? null)).toEqual([null, "all", "any"]);
    expect(interventions).toContainEqual(expect.objectContaining({ check: "key-term", action: "term-dropped", replacement: "years" }));
    expect(interventions).toContainEqual(expect.objectContaining({ check: "key-term", action: "mode-changed", replacement: "all" }));
  });

  it("clears the quote when no named term is in the CV", () => {
    const { requirements } = enforceRequirementStatuses(
      [{ requirement: "Terraform", kind: "required", status: "partial", evidence: "Databases: MongoDB, PostgreSQL, MySQL", note: "", assessable: true, sourceQuote: "Terraform", keyTerms: terms("all", ["Terraform", ""]) }],
      { pending: [{ alternative: "", yearsEvidence: [] }], cvText: CV, now: NOW },
    );
    expect(requirements[0]).toMatchObject({ status: "missing", evidence: "" });
  });

  it("swaps a skills-list quote for the experience bullet that shows the term, wrapped lines joined", () => {
    const { requirements, interventions } = withEvidenceSources(
      [
        { requirement: "React", kind: "required", status: "met", evidence: "Frontend development: React, Next.js", note: "", keyTerms: terms("all", ["React", "React"]) },
        { requirement: "MySQL", kind: "required", status: "partial", evidence: "Databases: MongoDB, PostgreSQL, MySQL", note: "", keyTerms: terms("all", ["Ruby on Rails", ""], ["MySQL", "MySQL"]) },
      ],
      CV,
      ["Summary", "Experience", "Technical Skills"],
    );

    expect(requirements[0]).toMatchObject({
      evidence: "• Designed and developed a full-stack web platform using the MERN stack (MongoDB, Express.js, React, Node.js) to manage pet adoption.",
      evidenceSource: "experience",
    });
    // Only in the skills list: it stays there, and the page says so.
    expect(requirements[1]).toMatchObject({ evidence: "Databases: MongoDB, PostgreSQL, MySQL", evidenceSource: "skills", skillsOnly: true });
    expect(interventions).toEqual([expect.objectContaining({ check: "evidence-source", action: "evidence-replaced", path: "jobFit.requirements[0].evidence" })]);
  });

  it("keeps a skills quote for an 'all' requirement no single line shows in full, without calling it skills-only, and never glues a role header to a bullet", () => {
    const cv = `Experience
Data Engineer - Sklepio, Warsaw September 2018 - June 2019
Maintained the PostgreSQL reporting replica and the Python ETL scripts that fed it.
Wrote dashboards in Looker for the finance team.
Skills
Python, Looker, SQL`;
    const { requirements } = withEvidenceSources(
      [
        { requirement: "Python and Looker", kind: "required", status: "met", evidence: "Python, Looker, SQL", note: "", keyTerms: terms("all", ["Python", "Python"], ["Looker", "Looker"]) },
        { requirement: "Python or Scala", kind: "required", status: "met", evidence: "Python, Looker, SQL", note: "", keyTerms: terms("any", ["Python", "Python"], ["Scala", ""]) },
      ],
      cv,
      ["Experience", "Skills"],
    );

    expect(requirements[0]).toMatchObject({ evidence: "Python, Looker, SQL", evidenceSource: "skills", skillsOnly: false });
    expect(requirements[1]).toMatchObject({ evidence: "Maintained the PostgreSQL reporting replica and the Python ETL scripts that fed it.", evidenceSource: "experience" });
  });
});
