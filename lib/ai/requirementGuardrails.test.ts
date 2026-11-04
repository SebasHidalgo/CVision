import { describe, expect, it } from "vitest";
import type { ModelRequirement, Requirement } from "@/lib/schemas/resumeSchema";
import {
  clauseAsRequirement,
  DOWNGRADE_NOTE,
  enforceRequirementStatuses,
  structureRequirements,
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
      entry({ kind: "preferred", softenedClause: { ...NO_CLAUSE, quote: "ideally in e-commerce or retail" } }),
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
