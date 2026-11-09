import { describe, expect, it } from "vitest";
import type { ModelRequirement, Requirement, ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";
import {
  absentTerms,
  alignToSource,
  clauseAsRequirement,
  coverageCap,
  cvEntries,
  DOWNGRADE_NOTE,
  enforceRequirementStatuses,
  evidenceSourceOf,
  guardBulletRoles,
  guardMatchedSkills,
  headingKind,
  isSkillYears,
  neededTerms,
  requirementHeadline,
  statedTotalYears,
  structureRequirements,
  termGroups,
  unshowableAlternativeIn,
  withEvidenceSources,
  withoutClause,
  withoutControlCharacters,
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

  it("keeps the entries when the section rule would leave none", () => {
    const { requirements, interventions } = structureRequirements(POSTING, [
      entry({ section: "description" }),
      entry({ sourceQuote: "Fluent English", section: "description", requirement: "Fluent English" }),
      entry({ sourceQuote: "A degree in statistics", requirement: "Degree in statistics" }),
    ]);

    expect(requirements.map((one) => one.requirement)).toEqual(["3+ years as a data or business analyst", "Fluent English"]);
    expect(interventions.map((one) => [one.check, one.action, one.replacement])).toEqual([
      ["posting-section", "recorded", "description, kept: nothing else survived"],
      ["posting-section", "recorded", "description, kept: nothing else survived"],
      ["posting-source", "requirement-dropped", undefined],
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
const ENCORA = `Duties and Responsibilities

* Ship React front-end features for the merchant dashboard and its reports

Skills and Qualifications

* 5+ years of experience building full stack web products
* Deep knowledge of Ruby on Rails and MySQL on the server side
* Hands-on use of tools such as Redis, Elasticsearch, and Sidekiq
* Working knowledge of Python or willingness to learn and work with it
* TypeScript experience is a plus
* Experience with a BI tool, preferably Power BI or Looker.`;

const CV = `Summary
Software Engineer with 2+ years of experience building internal tools for warehouses.
Experience
Full-Stack Developer July 2021 – November 2021
• Built a full-stack scheduling platform using the MERN stack (MongoDB, Express.js, React, Node.js) to
book volunteer shifts.
Technical Skills
Front end: React, Next.js
Databases: MongoDB, PostgreSQL, MySQL`;

const NOW = new Date("2026-11-04T00:00:00Z");
const terms = (mode: "all" | "any", ...pairs: [string, string][]) => ({ mode, terms: pairs.map(([term, cvMatch]) => ({ term, cvMatch })) });

describe("structureRequirements: kind from the posting's own wording", () => {
  it("makes a plain bullet under a qualifications heading required, and keeps a softened one preferred", () => {
    const { requirements, interventions } = structureRequirements(ENCORA, [
      entry({ sourceQuote: "Hands-on use of tools such as Redis, Elasticsearch, and Sidekiq", heading: "Skills and Qualifications", requirement: "Redis, Elasticsearch, Sidekiq", kind: "preferred" }),
      entry({ sourceQuote: "TypeScript experience is a plus", heading: "Skills and Qualifications", requirement: "TypeScript", kind: "preferred" }),
    ]);

    expect(requirements.map((one) => one.kind)).toEqual(["required", "preferred"]);
    expect(interventions).toEqual([expect.objectContaining({ check: "posting-kind", action: "kind-changed", replacement: "required" })]);
  });

  it("ignores a heading that comes after the quote", () => {
    const { requirements } = structureRequirements(ENCORA, [
      entry({ sourceQuote: "Ship React front-end features for the merchant dashboard", heading: "Skills and Qualifications", section: "responsibilities", demandsCapability: true, requirement: "React", kind: "preferred" }),
    ]);

    expect(requirements[0].kind).toBe("preferred");
  });

  it("reads headings", () => {
    expect(headingKind("Skills and Qualifications")).toBe("required");
    expect(headingKind("Additional/Preferred Qualifications")).toBe("preferred");
    expect(headingKind("Nice to have")).toBe("preferred");
    expect(headingKind("Valoramos")).toBe("preferred");
    expect(headingKind("Requisitos")).toBe("required");
    expect(headingKind("About Encora")).toBeNull();
    expect(headingKind("Minimum/Required Qualifications")).toBe("required");
    // The Microsoft posting's own heading over its background check: it states no kind, so the model's stands.
    expect(headingKind("Other & Additional Requirements")).toBeNull();
  });
});

describe("structureRequirements: key terms", () => {
  it("drops a term that is not in the quote and gives the softened clause its own terms", () => {
    const { requirements, interventions } = structureRequirements(ENCORA, [
      entry({
        sourceQuote: "Experience with a BI tool, preferably Power BI or Looker.",
        heading: "Skills and Qualifications",
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
    sourceQuote: "Deep knowledge of Ruby on Rails and MySQL on the server side",
    ...overrides,
  });
  const context = (count: number) => ({ pending: Array.from({ length: count }, () => ({ yearsEvidence: [] })), cvText: CV, now: NOW });

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
    requirement: "5+ years of experience building full stack web products",
    kind: "required",
    status: "partial",
    evidence: "Software Engineer with 2+ years of experience building internal tools for warehouses.",
    note: "the model's note",
    assessable: true,
    sourceQuote: "5+ years of experience building full stack web products",
    ...overrides,
  });
  const run = (requirement: Requirement, yearsEvidence: string[] = []) =>
    enforceRequirementStatuses([requirement], { pending: [{ yearsEvidence }], cvText: CV, now: NOW });

  it("calls 2 of 5 years missing and says both numbers", () => {
    const { requirements, interventions } = run(stored({}));

    expect(requirements[0]).toMatchObject({ status: "missing", years: { min: 5, candidate: 2, source: "statement" }, note: "The posting asks for 5+ years; your CV shows about 2." });
    expect(interventions[0]).toMatchObject({ check: "years", action: "status-capped", replacement: "missing" });
  });

  it("raises a partial the numbers support, and quotes the years line when the evidence was empty", () => {
    const { requirements } = run(stored({ sourceQuote: "1+ year(s) technical engineering experience", status: "partial", evidence: "" }), ["Software Engineer with 2+ years of experience building internal tools for warehouses."]);

    expect(requirements[0]).toMatchObject({ status: "met", years: { min: 1, candidate: 2 } });
    expect(requirements[0].evidence).toContain("2+ years");
  });

  it("never raises a missing: the model may have ruled the quoted years irrelevant", () => {
    const { requirements } = run(stored({ sourceQuote: "1+ year(s) of professional embedded C development", status: "missing", evidence: "" }), ["Software Engineer with 2+ years of experience building internal tools for warehouses."]);

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
    ["Working knowledge of Python or willingness to learn and work with it", "or willingness to learn and work with it"],
    ["Experience with GraphQL schema design, or a clear appetite to learn it fast.", "or a clear appetite to learn it fast"],
    ["Conocimientos de Airflow o disposición para aprenderlo.", "o disposición para aprenderlo"],
    ["Kotlin, or eagerness to pick it up", "or eagerness to pick it up"],
  ])("finds it in %s", (quote, alternative) => {
    expect(unshowableAlternativeIn(quote)).toBe(alternative);
  });

  it.each([
    "Degree in Computer Science, Information Systems, or a related field, or equivalent practical experience",
    "You pick up one existing service, learn its failure modes on call",
    "Must be willing to travel to client sites",
    "Continuously seeks new knowledge, adapts to emerging technologies",
  ])("finds none in %s", (quote) => {
    expect(unshowableAlternativeIn(quote)).toBeNull();
  });

  it("turns missing into not_evident with a note naming what is absent, and leaves met alone", () => {
    const python = "Working knowledge of Python or willingness to learn and work with it";
    const { requirements, interventions } = enforceRequirementStatuses(
      [
        { requirement: python, kind: "required", status: "missing", evidence: "", note: "Python is absent", assessable: true, sourceQuote: python, keyTerms: terms("any", ["Python", ""]) },
        { requirement: python, kind: "required", status: "met", evidence: "Python (pandas)", note: "", assessable: true, sourceQuote: python, keyTerms: terms("any", ["Python", "Python"]) },
      ],
      { pending: [{ yearsEvidence: [] }, { yearsEvidence: [] }], cvText: `${CV}\nPython (pandas)`, now: NOW },
    );

    expect(requirements.map((one) => [one.status, one.assessable])).toEqual([["not_evident", false], ["met", false]]);
    expect(requirements[0].note).toBe("Python isn't in your CV; the posting accepts willingness to learn and work with it — say so in your cover letter.");
    expect(interventions).toContainEqual(expect.objectContaining({ check: "unshowable-alternative", action: "recorded" }));
  });

  it("writes its own note when the model chose not_evident itself, and drops a quote that showed nothing", () => {
    const python = "Working knowledge of Python or willingness to learn and work with it";
    const { requirements } = enforceRequirementStatuses(
      [{ requirement: python, kind: "required", status: "not_evident", evidence: "Databases: MongoDB, PostgreSQL, MySQL", note: "the unshowable alternative covers it", assessable: false, sourceQuote: python, keyTerms: terms("any", ["Python", ""]) }],
      { pending: [{ yearsEvidence: [] }], cvText: CV, now: NOW },
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
    expect(evidenceSourceOf(CV, "Front end: React, Next.js", headings)).toBe("skills");
    expect(evidenceSourceOf(CV, "• Built a full-stack scheduling platform using the MERN stack (MongoDB, Express.js, React, Node.js) to book volunteer shifts.", headings)).toBe("experience");
    expect(evidenceSourceOf(CV, "Software Engineer with 2+ years of experience", headings)).toBe("summary");
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
    expect(requirementHeadline([req({}), req({ kind: "preferred", status: "missing" })])).toBe("You meet every required qualification.");
    expect(requirementHeadline([req({ kind: "preferred" })])).toBe("");
  });

  it("counts the required ones the CV doesn't show instead of claiming every one is met", () => {
    expect(requirementHeadline([req({}), req({ status: "not_evident" }), req({ status: "not_evident" })])).toBe(
      "No core gaps; 2 required items aren't shown in your CV.",
    );
    expect(requirementHeadline([req({ status: "not_evident" })])).toBe("No core gaps; 1 required item isn't shown in your CV.");
    expect(requirementHeadline([req({ status: "missing", requirement: "Go" }), req({ status: "not_evident" })])).toBe("Core gaps: Go.");
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
          { name: "React", evidence: "Front end: React, Next.js" },
          { name: "Redis", evidence: "" },
          { name: "Python", evidence: "Databases: MongoDB, PostgreSQL, MySQL" },
          { name: "Postgres 16", evidence: "Databases: MongoDB, PostgreSQL, MySQL" },
        ],
      },
      jobFit: { requirements: [{ requirement: "Postgres 16", kind: "required", status: "met", evidence: "", note: "", keyTerms: terms("all", ["Postgres 16", "PostgreSQL"]) }] },
    } as unknown as ResumeAnalysisFeedback;

    const { feedback: kept, interventions } = guardMatchedSkills(feedback, CV);

    // "Postgres 16" is in no CV line, but a key term verified it through the CV's own word.
    expect(kept.skills.matchedSkills.map((one) => one.name)).toEqual(["React", "Postgres 16"]);
    expect(interventions.map((one) => [one.value, one.replacement])).toEqual([
      ["Redis", "no evidence"],
      ["Python", "not in the CV"],
      ["Postgres 16", "synonym: PostgreSQL"],
    ]);
  });
});

describe("M8-D: control characters, bullet roles, the CV's own years", () => {
  it("strips control characters from every string", () => {
    expect(withoutControlCharacters({ role: "Asociaci\u0003on", list: ["a\u0000b"], n: 3, keep: "line\none" })).toEqual({ role: "Asociacion", list: ["ab"], n: 3, keep: "line\none" });
  });

  it("keeps a role label the CV has, and replaces one it does not with the entry's title and company lines", () => {
    const feedback = {
      atsCompatibility: { sectionsDetected: ["Summary", "Experience", "Technical Skills"] },
      experienceAndImpact: {
        suggestedBullets: [
          { role: "Full-Stack Developer, Asociaci\u0003on", examples: ["x"] },
          { role: "Lead Architect, Globex", examples: ["y"] },
          { role: "Senior Full-Stack Developer", examples: ["z"] },
        ],
      },
    } as unknown as ResumeAnalysisFeedback;
    const cv = CV.replace("Full-Stack Developer July 2021 – November 2021", "Full-Stack Developer July 2021 – November 2021\nAsociaci´on Ejemplo Springfield");

    const { feedback: checked, interventions } = guardBulletRoles(feedback, cv);

    expect(checked.experienceAndImpact.suggestedBullets.map((one) => one.role)).toEqual([
      "Full-Stack Developer, Asociacion",
      "Lead Architect, Globex",
      "Full-Stack Developer, Asociaci´on Ejemplo Springfield",
    ]);
    expect(interventions.map((one) => one.replacement)).toEqual(["Lead Architect, Globex", "Full-Stack Developer, Asociaci´on Ejemplo Springfield"]);
  });

  const ROLES_CV = `Experience
Help Desk Analyst March 2018 – January 2019
Northwind Cooperative Springfield
• Built an inventory sync service in Go, improving stock accuracy across the
warehouses.
• Ran help desk support, cutting downtime by about 40% during the migration.
Data Analyst March 2021 – May 2022
Contoso Retail Shelbyville
• Cut report build time by 30% by moving 12 dashboards to dbt.`;

  const withExamples = (role: string, examples: string[]) =>
    ({ atsCompatibility: { sectionsDetected: ["Experience"] }, experienceAndImpact: { suggestedBullets: [{ role, examples }] } }) as unknown as ResumeAnalysisFeedback;

  it("placeholds a figure moved onto another bullet of the same role, and keeps a bullet's own", () => {
    const { feedback, interventions } = guardBulletRoles(
      withExamples("Help Desk Analyst, Northwind Cooperative", [
        "Built an inventory sync service in Go, improving stock accuracy and cutting downtime by about 40%.",
        "Ran help desk support during the migration, cutting downtime by about 40%.",
      ]),
      ROLES_CV,
    );
    expect(feedback.experienceAndImpact.suggestedBullets[0].examples).toEqual([
      "Built an inventory sync service in Go, improving stock accuracy and cutting downtime by about [X]%.",
      "Ran help desk support during the migration, cutting downtime by about 40%.",
    ]);
    expect(interventions).toEqual([expect.objectContaining({ check: "bullet-figure", action: "number-placeheld", value: "40" })]);
  });

  it("checks a bullet with no source against its role, so another role's figure is placeheld", () => {
    const { feedback } = guardBulletRoles(withExamples("Data Analyst, Contoso Retail", ["Owned 12 dashboards and halved support tickets by 40%."]), ROLES_CV);
    expect(feedback.experienceAndImpact.suggestedBullets[0].examples).toEqual(["Owned 12 dashboards and halved support tickets by [X]%."]);
  });

  it("reads entries as title and company lines followed by bullets with their wrapped lines", () => {
    expect(cvEntries(ROLES_CV, ["Experience"]).map((entry) => [entry.header, entry.bullets.length])).toEqual([
      [["Help Desk Analyst March 2018 – January 2019", "Northwind Cooperative Springfield"], 2],
      [["Data Analyst March 2021 – May 2022", "Contoso Retail Shelbyville"], 1],
    ]);
  });

  it("reads the CV's own total from its summary, ignoring a skill's years in parentheses", () => {
    expect(statedTotalYears(CV, ["Summary", "Experience", "Technical Skills"])).toBe(2);
    expect(statedTotalYears("Jane Doe\nSKILLS\nPython (6 years), SQL\nSUMMARY\nData engineer with six years of experience building pipelines", ["SKILLS", "SUMMARY"])).toBe(6);
    // Only an explicit total: "eight years on JVM services" or "3 years in fintech" is not one.
    expect(statedTotalYears("SUMMARY\nSenior engineer with eight years on JVM services, 3 years in fintech", ["SUMMARY"])).toBeNull();
    expect(statedTotalYears("Jane Doe\nEXPERIENCE\nLed the team for three years", ["EXPERIENCE"])).toBeNull();
  });

  it("uses the CV's total over the lines the model quoted, lowers with it, and raises only when the quoted years agree", () => {
    const fiveYears = "5+ years of experience building full stack web products";
    const base = { kind: "required" as const, note: "model note", assessable: true, evidence: "Full-Stack Developer July 2021 – November 2021" };
    const { requirements } = enforceRequirementStatuses(
      [
        { ...base, requirement: fiveYears, sourceQuote: fiveYears, status: "partial" },
        { ...base, requirement: "1+ year of React", sourceQuote: "1+ year of React", status: "partial" },
      ],
      { pending: [{ yearsEvidence: [] }, { yearsEvidence: [] }], cvText: CV, now: NOW, statedYears: 2 },
    );

    expect(requirements[0]).toMatchObject({ status: "missing", years: { min: 5, candidate: 2, source: "statement" }, note: "The posting asks for 5+ years; your CV shows about 2." });
    // The quoted role covers 5 months: the total alone does not raise a partial.
    expect(requirements[1]).toMatchObject({ status: "partial", note: "model note" });
  });

  it("writes no years note where a key term, not the years, decided the status", () => {
    const python = "3+ years writing production Python";
    const base = { kind: "required" as const, assessable: true, requirement: python, sourceQuote: python };
    const { requirements } = enforceRequirementStatuses(
      [
        // Seen in M8-D: missing for Python, and the note said "your CV shows about 8".
        { ...base, status: "missing", evidence: "", note: "No Python in the CV.", keyTerms: terms("all", ["Python", ""]) },
        { ...base, requirement: "3+ years of experience", sourceQuote: "3+ years of experience", status: "met", evidence: "Built the ETL in Python", note: "model note" },
      ],
      { pending: [{ yearsEvidence: [] }, { yearsEvidence: [] }], cvText: "SUMMARY\nEngineer with eight years on JVM services.\nBuilt the ETL in Python", now: NOW, statedYears: 8 },
    );

    expect(requirements.map((one) => [one.status, one.note])).toEqual([
      ["missing", "No Python in the CV."],
      ["met", "The posting asks for 3+ years; your CV shows about 8."],
    ]);
  });

  it("still lowers a skill's item with the CV's total, which bounds it from above", () => {
    const python = "5+ years writing production Python";
    const { requirements } = enforceRequirementStatuses(
      [{ kind: "required", assessable: true, requirement: python, sourceQuote: python, status: "met", evidence: "Built the ETL in Python", note: "", keyTerms: terms("all", ["Python", "Python"]) }],
      { pending: [{ yearsEvidence: [] }], cvText: "SUMMARY\nEngineer with two years of experience.\nBuilt the ETL in Python", now: NOW, statedYears: 2 },
    );

    expect(requirements[0]).toMatchObject({ status: "missing", note: "The posting asks for 5+ years; your CV shows about 2 in total." });
  });

  it("caps a skill's years by the total but never confirms them with it, and takes the skill's own quoted years", () => {
    const python = "3+ years writing production Python";
    const base = { kind: "required" as const, assessable: true, requirement: python, sourceQuote: python, keyTerms: terms("all", ["Python", "Python"]) };
    const cv = "SUMMARY\nEngineer with 8 years of experience.\nEXPERIENCE\nData Engineer March 2025 – March 2026\n• Built the ETL in Python";
    const { requirements } = enforceRequirementStatuses(
      [
        { ...base, status: "met", evidence: "• Built the ETL in Python", note: "Python at the data team." },
        { ...base, status: "met", evidence: "• Built the ETL in Python", note: "Python at the data team." },
      ],
      { pending: [{ yearsEvidence: [] }, { yearsEvidence: ["Data Engineer March 2025 – March 2026"] }], cvText: cv, now: NOW, statedYears: 8 },
    );
    // Eight years in total say nothing about Python: undetermined, the model's status stands.
    expect(requirements[0]).toMatchObject({ status: "met", note: "Python at the data team." });
    // The quoted Python role is one year: below 75% of three.
    expect(requirements[1]).toMatchObject({ status: "missing", note: "The posting asks for 3+ years; your CV shows about 1." });
  });

  it("tells a skill's years from a role's", () => {
    expect(isSkillYears({ sourceQuote: "3+ years writing production Python", keyTerms: terms("all", ["Python", ""]) })).toBe(true);
    expect(isSkillYears({ sourceQuote: "5+ years in infrastructure, platform or SRE roles", keyTerms: terms("any", ["infrastructure, platform or SRE roles", ""]) })).toBe(false);
    expect(isSkillYears({ sourceQuote: "Al menos 4 años de experiencia como analista de datos", keyTerms: terms("all", ["analista de datos", ""]) })).toBe(false);
    expect(isSkillYears({ sourceQuote: "5+ years of experience building full stack web products" })).toBe(false);
  });
});

describe("M8-C smoke fixes", () => {
  it("drops a number of years from the key terms, and reads 'and' as all", () => {
    const posting = `${ENCORA}\n* dbt and data contracts.`;
    const { requirements, interventions } = structureRequirements(posting, [
      entry({ sourceQuote: "5+ years of experience building full stack web products", heading: "Skills and Qualifications", requirement: "5+ years", keyTerms: terms("all", ["5+ years of experience", "2+ years of experience"]) }),
      entry({ sourceQuote: "dbt and data contracts.", heading: "Skills and Qualifications", requirement: "dbt and data contracts", keyTerms: terms("any", ["dbt", ""], ["data contracts", "data contracts"]) }),
      entry({ sourceQuote: "Hands-on use of tools such as Redis, Elasticsearch, and Sidekiq", heading: "Skills and Qualifications", requirement: "Redis", keyTerms: terms("any", ["Redis", ""], ["Sidekiq", ""]) }),
    ]);

    expect(requirements.map((one) => one.keyTerms?.mode ?? null)).toEqual([null, "all", "any"]);
    expect(interventions).toContainEqual(expect.objectContaining({ check: "key-term", action: "term-dropped", replacement: "years" }));
    expect(interventions).toContainEqual(expect.objectContaining({ check: "key-term", action: "mode-changed", replacement: "all" }));
  });

  it("clears the quote when no named term is in the CV", () => {
    const { requirements } = enforceRequirementStatuses(
      [{ requirement: "Terraform", kind: "required", status: "partial", evidence: "Databases: MongoDB, PostgreSQL, MySQL", note: "", assessable: true, sourceQuote: "Terraform", keyTerms: terms("all", ["Terraform", ""]) }],
      { pending: [{ yearsEvidence: [] }], cvText: CV, now: NOW },
    );
    expect(requirements[0]).toMatchObject({ status: "missing", evidence: "" });
  });

  it("swaps a skills-list quote for the experience bullet that shows the term, wrapped lines joined", () => {
    const { requirements, interventions } = withEvidenceSources(
      [
        { requirement: "React", kind: "required", status: "met", evidence: "Front end: React, Next.js", note: "", keyTerms: terms("all", ["React", "React"]) },
        { requirement: "MySQL", kind: "required", status: "partial", evidence: "Databases: MongoDB, PostgreSQL, MySQL", note: "", keyTerms: terms("all", ["Ruby on Rails", ""], ["MySQL", "MySQL"]) },
      ],
      CV,
      ["Summary", "Experience", "Technical Skills"],
    );

    expect(requirements[0]).toMatchObject({
      evidence: "• Built a full-stack scheduling platform using the MERN stack (MongoDB, Express.js, React, Node.js) to book volunteer shifts.",
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

describe("M8-C measurement fixes", () => {
  it("groups terms the posting joins with 'or', or lists in one parenthesis", () => {
    expect(termGroups("Dominio de SQL y experiencia con un almacén de datos en la nube (BigQuery o Snowflake).", ["SQL", "BigQuery", "Snowflake"])).toEqual([[0], [1, 2]]);
    expect(termGroups("Experience with observability tooling (Prometheus, Grafana, OpenTelemetry).", ["Prometheus", "Grafana", "OpenTelemetry"])).toEqual([[0, 1, 2]]);
    expect(termGroups("Deep knowledge of Ruby on Rails and MySQL on the server side", ["Ruby on Rails", "MySQL"])).toEqual([[0], [1]]);
    expect(termGroups("coding in C, C++, C#, Java, JavaScript, or Python", ["C++", "Java", "Python"])).toEqual([[0, 1, 2]]);
  });

  it("counts a group as covered by one shown term, and drops the alternatives not needed", () => {
    const quote = "Dominio de SQL y experiencia con un almacén de datos en la nube (BigQuery o Snowflake).";
    const keyTerms = terms("all", ["SQL", "SQL"], ["BigQuery", "BigQuery"], ["Snowflake", ""]);

    expect(coverageCap(keyTerms, quote)).toBeNull();
    expect(neededTerms(keyTerms, quote).terms.map((term) => term.term)).toEqual(["SQL", "BigQuery"]);
    expect(coverageCap(terms("all", ["SQL", ""], ["BigQuery", "BigQuery"], ["Snowflake", ""]), quote)).toBe("partial");
  });

  it("keeps examples in a parenthesis as alternatives when the model says 'any'", () => {
    const posting = `${ENCORA}\n* Experience with observability tooling (Prometheus, Grafana, OpenTelemetry).`;
    const { requirements, interventions } = structureRequirements(posting, [
      entry({ sourceQuote: "Experience with observability tooling (Prometheus, Grafana, OpenTelemetry).", heading: "Skills and Qualifications", requirement: "Observability tooling", keyTerms: terms("any", ["Prometheus", "Prometheus"], ["OpenTelemetry", ""]) }),
    ]);
    expect(requirements[0].keyTerms?.mode).toBe("any");
    expect(interventions.some((one) => one.action === "mode-changed")).toBe(false);
  });

  it("quotes the CV line of a verified match when the model's quote was dropped, instead of downgrading", () => {
    const { requirements, interventions } = enforceRequirementStatuses(
      [{ requirement: "React", kind: "required", status: "met", evidence: "", note: "", assessable: true, sourceQuote: "React", keyTerms: terms("all", ["React", "React"]) }],
      { pending: [{ yearsEvidence: [] }], cvText: CV, now: NOW },
    );
    expect(requirements[0]).toMatchObject({ status: "met", evidence: "• Built a full-stack scheduling platform using the MERN stack (MongoDB, Express.js, React, Node.js) to book volunteer shifts." });
    expect(interventions).toContainEqual(expect.objectContaining({ check: "evidence-source", action: "evidence-replaced", value: "" }));
  });

  it("keeps the model's note when its status is below what the numbers allow", () => {
    const { requirements } = enforceRequirementStatuses(
      [{ requirement: "6+ years of backend", kind: "required", status: "missing", evidence: "", note: "The CV shows pastry work, not backend.", assessable: true, sourceQuote: "1+ year(s) of backend software development" }],
      { pending: [{ yearsEvidence: ["Software Engineer with 2+ years of experience building internal tools for warehouses."] }], cvText: CV, now: NOW },
    );
    expect(requirements[0]).toMatchObject({ status: "missing", note: "The CV shows pastry work, not backend." });
  });
});

describe("M8-C language", () => {
  const english = "Fluency to speak, read and write in English.";

  it("calls a language requirement not shown, even when assessable, unless the CV states a level", () => {
    const pending = [{ yearsEvidence: [] }, { yearsEvidence: [] }, { yearsEvidence: [] }];
    const asked = [
      { requirement: english, kind: "required" as const, status: "met" as const, evidence: "Worked in distributed international teams", note: "", assessable: true, sourceQuote: english },
      { requirement: "Writes clearly in English and Spanish", kind: "required" as const, status: "missing" as const, evidence: "", note: "model note", assessable: true, sourceQuote: "writes clearly in English and Spanish" },
      { requirement: "Fluent German", kind: "required" as const, status: "partial" as const, evidence: "German (A2)", note: "model note", assessable: true, sourceQuote: "Fluent German" },
    ];

    // A CV written in English with no level stated anywhere; "writes clearly" is not a level, so the model decides it.
    const { requirements, interventions } = enforceRequirementStatuses(asked, { pending, cvText: CV, now: NOW });
    expect(requirements.map((one) => one.status)).toEqual(["not_evident", "missing", "not_evident"]);
    expect(requirements[0]).toMatchObject({ evidence: "", assessable: true, note: "Your CV doesn't state your English level. Add a Languages line, e.g. 'Spanish (native), English (C1)'." });
    expect(requirements[1].note).toBe("model note");
    expect(interventions.filter((one) => one.check === "language-level")).toHaveLength(2);

    // A Languages line: the model's judgement of the stated level stands.
    const stated = enforceRequirementStatuses(asked, { pending, cvText: `${CV}\nLANGUAGES\nSpanish (native), English (C1), German (A2)`, now: NOW });
    expect(stated.requirements.map((one) => one.status)).toEqual(["met", "missing", "partial"]);
  });

  it("names absent alternatives with 'or' and the rest with 'and'", () => {
    const quote = "Production experience with Kubernetes and a major cloud provider (AWS or GCP).";
    expect(absentTerms(terms("all", ["Kubernetes", ""], ["AWS", ""], ["GCP", ""]), quote)).toBe("Kubernetes and AWS or GCP");
    expect(absentTerms(terms("all", ["Kubernetes", ""], ["AWS", ""], ["GCP", ""]), quote, "es")).toBe("Kubernetes y AWS o GCP");
  });

  it("writes the headline and its notes in the analysis language", () => {
    const quote = "Conocimientos de Airflow o disposición para aprenderlo.";
    const { requirements } = enforceRequirementStatuses(
      [
        { requirement: quote, kind: "required", status: "missing", evidence: "", note: "", assessable: true, sourceQuote: quote, keyTerms: terms("any", ["Airflow", ""]) },
        { requirement: "Al menos 4 años", kind: "required", status: "partial", evidence: "Software Engineer with 2+ years of experience building internal tools for warehouses.", note: "", assessable: true, sourceQuote: "Al menos 4 años de experiencia como analista" },
      ],
      { pending: [{ yearsEvidence: [] }, { yearsEvidence: [] }], cvText: CV, now: NOW, language: "es" },
    );

    expect(requirements[0].note).toBe("Airflow no aparece en tu CV; la oferta acepta disposición para aprenderlo: dilo en tu carta de presentación.");
    expect(requirements[1].note).toBe("La oferta pide 4+ años; tu CV muestra unos 2.");
    expect(requirementHeadline(requirements, "es")).toBe("Brechas principales: 4+ años de experiencia.");
  });
});
